/* =============================================
   MCN CONNECTIVITY — GRAPH ENGINE
   2D: D3 force simulation drawn as SVG.
   3D: the same nodes and links drawn with 3d-force-graph (WebGL), whose
       library is loaded on demand the first time 3D is chosen.
   ============================================= */

(function () {
  "use strict";

  // ── Color palettes ─────────────────────────
  // Dynamic year→color: maps any year in the archive to a perceptual hue
  // Uses a modified rainbow that avoids pure green (hard to see on dark bg)
  const YEAR_MIN = 1988;
  const YEAR_MAX = 2030;

  function yearColor(year) {
    const t = (year - YEAR_MIN) / (YEAR_MAX - YEAR_MIN);
    // Cycle through a hand-tuned hue arc: blue→cyan→yellow→orange→pink→violet
    const hue = (220 + t * 300) % 360;
    const sat = Math.round(80 + 15 * Math.sin(t * Math.PI));
    const lit = Math.round(58 + 10 * Math.cos(t * Math.PI * 2));
    return `hsl(${Math.round(hue)},${sat}%,${lit}%)`;
  }

  const MULTI_COLOR = "#e2e8f0";

  const ROLE_COLORS = {
    director: "#f97316",
    faculty:  "#60a5fa",
    lecturer: "#a78bfa",
    ta:       "#34d399",
    student:  "#94a3b8",
  };

  const ROLE_RADIUS = {
    director: 14,
    faculty:  12,
    lecturer: 10,
    ta:       8,
    student:  7,
  };

  // Distinct look for the two edge layers.
  const ATTEND_COLOR = "#6366f1"; // indigo — used for multi-year co-attendance
  const COLLAB_COLOR = "#fbbf24"; // amber  — co-authorship edges stand out

  // ── 3D tuning ──────────────────────────────
  // Sphere radius = ROLE_RADIUS × this, in the same units as link lengths.
  const NODE_SCALE_3D = 0.9;
  // Co-attendance links form one clique per cohort: ~6.5k among students but
  // ~42k with every role shown, far more line objects than WebGL handles
  // smoothly. Above this count 3D still uses them to shape the layout but only
  // draws the ones touching the selected person.
  const MAX_ATTEND_LINKS_3D = 8000;
  // Opacity of whatever lies outside the current selection or search.
  const DIM_ALPHA_3D = 0.1;
  // Closest the camera comes when flying to a person or a search.
  const FOCUS_DISTANCE_3D = 160;
  const REDUCE_MOTION = !!(window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const ms = t => (REDUCE_MOTION ? 0 : t); // camera transition length

  // ── Co-authorship data (optional) ──────────
  // collabs.js defines MCN_COLLABS = { edges, resolved, aliases }. If it wasn't
  // generated yet, the graph gracefully falls back to co-attendance only.
  const COLLABS  = (typeof MCN_COLLABS !== "undefined") ? MCN_COLLABS : null;
  const ALIASES  = (COLLABS && COLLABS.aliases)  || {};
  const RESOLVED = (COLLABS && COLLABS.resolved) || {};
  const HAS_COLLABS = !!(COLLABS && COLLABS.edges && COLLABS.edges.length);

  // Collapse roster spelling variants onto one canonical name so co-authorship
  // edges land on the same node the person is drawn as.
  function canon(name) { return ALIASES[name] || name; }

  // careerInfo is hand-curated and may use a spelling that itself has an
  // alias (e.g. "Terrence Sejnowski" while the canonical node is "Terrence J
  // Sejnowski") — re-key it through canon() once so lookups by canonical name
  // always find it, regardless of which variant a curator typed.
  const CAREER_INFO = {};
  for (const [name, info] of Object.entries(MCN_DATA.careerInfo || {})) {
    CAREER_INFO[canon(name)] = info;
  }

  // Fast lookup: "canonA|||canonB" (sorted) → { papers, years, titles }.
  const collabPairMap = new Map();
  if (COLLABS && COLLABS.edges) {
    for (const e of COLLABS.edges) {
      const key = [e.source, e.target].sort().join("|||");
      collabPairMap.set(key, e);
    }
  }

  // ── Research-domain data (optional) ────────
  // domains.js defines MCN_DOMAINS = { subfields:[{name,count}], byPerson }.
  // Absent → the Domain color/filter/layout simply stay unavailable.
  const DOMAINS = (typeof MCN_DOMAINS !== "undefined") ? MCN_DOMAINS : null;
  const HAS_DOMAINS = !!(DOMAINS && DOMAINS.byPerson);
  const OTHER_DOMAIN = "Other";
  const OTHER_COLOR = "#64748b"; // slate grey for unlabeled / long-tail domains

  // A person's primary research domain (subfield), or null.
  function domainOf(name) {
    return (HAS_DOMAINS && DOMAINS.byPerson[name] && DOMAINS.byPerson[name].domain) || null;
  }

  // Raw subfields outnumber distinguishable colors, so give the most common
  // TOP_DOMAINS a distinct categorical hue and fold the long tail into "Other".
  const TOP_DOMAINS = 14;
  const DOMAIN_PALETTE = [
    "#60a5fa", "#f97316", "#34d399", "#a78bfa", "#f472b6", "#facc15",
    "#22d3ee", "#fb7185", "#4ade80", "#c084fc", "#fdba74", "#38bdf8",
    "#e879f9", "#2dd4bf",
  ];
  const domainColorMap = new Map(); // domain → color (top ones only)
  const legendDomains = [];         // [{name, color}] shown in the legend
  if (HAS_DOMAINS && DOMAINS.subfields) {
    let ci = 0;
    for (const s of DOMAINS.subfields) {
      if (s.name === OTHER_DOMAIN) continue;       // "Other" is always grey, shown once
      if (ci >= TOP_DOMAINS) break;
      const color = DOMAIN_PALETTE[ci % DOMAIN_PALETTE.length];
      domainColorMap.set(s.name, color);
      legendDomains.push({ name: s.name, color });
      ci++;
    }
  }
  function subfieldColor(name) {
    return domainColorMap.get(name) || OTHER_COLOR;
  }

  // ── State ──────────────────────────────────
  // Defaults favor a lighter, curated first view: students only (fewer nodes
  // to simulate/render), co-authorship edges (sparser than the co-attendance
  // cliques), colored by research domain. Each falls back gracefully if the
  // data it needs isn't available.
  let state = {
    selectedYears: new Set(["all"]),
    selectedRole:  "student",
    // Edge layer to display: "attend" (co-attendance), "collab" (co-authorship),
    // or "both".
    edgeMode:      HAS_COLLABS ? "collab" : "attend",
    colorBy:       HAS_DOMAINS ? "domain" : "year",
    selectedDomain:"all",
    layout:        "force",
    // "2d" (SVG) or "3d" (WebGL). A "#3d" URL opens straight into 3D, so the
    // 3D view can be linked to directly.
    view:          location.hash === "#3d" ? "3d" : "2d",
    searchQuery:   "",
    selectedNode:  null,
  };

  let simulation, allNodes, allLinks, svg, linkSel, nodeSel;
  let attendCount = 0; // co-attendance links in the current view
  const width  = () => document.getElementById("graphContainer").clientWidth;
  const height = () => document.getElementById("graphContainer").clientHeight;

  // A link's endpoint ids. Both force engines swap the id strings for node
  // objects once they start, so accept either form.
  function endIds(l) {
    return [
      typeof l.source === "object" ? l.source.id : l.source,
      typeof l.target === "object" ? l.target.id : l.target,
    ];
  }

  // Ids of a person plus everyone linked to them in the active layer(s).
  function neighborhoodOf(id) {
    const ids = new Set([id]);
    for (const l of allLinks) {
      const [s, t] = endIds(l);
      if (s === id) ids.add(t);
      else if (t === id) ids.add(s);
    }
    return ids;
  }

  // Ids whose name, affiliation or current role match the search box, or
  // null when the box is empty.
  function searchHits() {
    const q = state.searchQuery.toLowerCase().trim();
    if (!q) return null;
    const hits = new Set();
    for (const n of allNodes) {
      const career = CAREER_INFO[n.name];
      const haystack = [n.name, career?.affiliation, career?.role].filter(Boolean).join(" ").toLowerCase();
      if (haystack.includes(q)) hits.add(n.id);
    }
    return hits;
  }

  // ── Build graph data from MCN_DATA ─────────
  function buildGraphData(yearFilter = "all", roleFilter = "all") {
    const personMap = new Map(); // name → node

    function getOrCreate(name, role, year) {
      let node = personMap.get(name);
      if (!node) {
        node = { id: name, name, roles: new Set(), years: new Set(), primaryRole: role };
        personMap.set(name, node);
      }
      node.roles.add(role);
      node.years.add(year);
      // Priority: director > faculty > lecturer > ta > student
      const priority = { director:0, faculty:1, lecturer:2, ta:3, student:4 };
      if (priority[role] < priority[node.primaryRole]) node.primaryRole = role;
      return node;
    }

    // Iterate over the years we're showing
    const yearsToShow = yearFilter === "all"
      ? MCN_DATA.years
      : [parseInt(yearFilter)].filter(y => MCN_DATA.years.includes(y));

    for (const year of yearsToShow) {
      const cohort = MCN_DATA.cohorts[year];
      if (!cohort) continue;
      const groups = [
        ["director", cohort.directors || []],
        ["faculty",  cohort.faculty   || []],
        ["lecturer", cohort.lecturers || []],
        ["ta",       cohort.tas       || []],
        ["student",  cohort.students  || []],
      ];
      for (const [role, names] of groups) {
        for (const name of names) {
          getOrCreate(canon(name), role, year);
        }
      }
    }

    // Filter by role if needed
    let nodes = Array.from(personMap.values());
    if (roleFilter !== "all") {
      nodes = nodes.filter(n => n.primaryRole === roleFilter);
    }

    // Filter by research domain if needed
    if (state.selectedDomain !== "all") {
      nodes = nodes.filter(n => domainOf(n.id) === state.selectedDomain);
    }

    const nodeSet = new Set(nodes.map(n => n.id));

    // ── Co-attendance edges: people who appeared in the same cohort year ──
    const edgeMap = new Map();
    for (const year of yearsToShow) {
      const cohort = MCN_DATA.cohorts[year];
      if (!cohort) continue;
      const all = [
        ...(cohort.directors||[]), ...(cohort.faculty||[]), ...(cohort.lecturers||[]),
        ...(cohort.tas||[]),       ...(cohort.students||[]),
      ].map(canon).filter(n => nodeSet.has(n));

      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          if (all[i] === all[j]) continue; // aliasing can collapse two names
          const key = [all[i], all[j]].sort().join("|||");
          if (!edgeMap.has(key)) {
            edgeMap.set(key, { source: all[i], target: all[j], type: "attend",
                               years: new Set(), weight: 0 });
          }
          edgeMap.get(key).years.add(year);
          edgeMap.get(key).weight++;
        }
      }
    }
    const attendLinks = Array.from(edgeMap.values()).filter(
      l => nodeSet.has(l.source) && nodeSet.has(l.target)
    );

    // ── Co-authorship edges: from MCN_COLLABS, both endpoints in view ──
    const collabLinks = [];
    if (COLLABS && COLLABS.edges) {
      for (const e of COLLABS.edges) {
        if (!nodeSet.has(e.source) || !nodeSet.has(e.target)) continue;
        collabLinks.push({
          source: e.source, target: e.target, type: "collab",
          papers: e.papers, weight: e.papers,
          years: new Set(e.years || []), titles: e.sampleTitles || [],
        });
      }
    }

    // ── Choose the active layer(s) ──
    let links;
    if (state.edgeMode === "attend")      links = attendLinks;
    else if (state.edgeMode === "collab") links = collabLinks;
    else                                  links = attendLinks.concat(collabLinks);

    // Attach degree to each node
    const degMap = new Map();
    for (const l of links) {
      degMap.set(l.source, (degMap.get(l.source)||0) + 1);
      degMap.set(l.target, (degMap.get(l.target)||0) + 1);
    }
    for (const n of nodes) {
      n.degree = degMap.get(n.id) || 0;
    }

    return { nodes, links };
  }

  // ── Color resolver ─────────────────────────
  function nodeColor(d) {
    if (state.colorBy === "role") {
      return ROLE_COLORS[d.primaryRole] || "#64748b";
    }
    if (state.colorBy === "domain") {
      return subfieldColor(domainOf(d.id));
    }
    if (state.colorBy === "degree") {
      return d3.interpolateViridis(Math.min(d.degree / 50, 1));
    }
    // By year — use earliest year for people who attended multiple
    const yrs = Array.from(d.years).sort();
    if (yrs.length === 1) return yearColor(yrs[0]);
    return MULTI_COLOR; // multi-year attendees → white
  }

  // Co-authorship links are amber; co-attendance links take their cohort's
  // year color, or indigo when the pair shared several cohorts.
  function linkColor(l) {
    if (l.type === "collab") return COLLAB_COLOR;
    const yrs = Array.from(l.years).sort();
    return yrs.length === 1 ? yearColor(yrs[0]) : ATTEND_COLOR;
  }

  // ── Legend ─────────────────────────────────
  function renderLegend() {
    const el = document.getElementById("legend");
    el.innerHTML = "";

    if (state.colorBy === "year") {
      // Gradient bar spanning the full year range
      const years = [...MCN_DATA.years].sort();
      const first = years[0], last = years[years.length - 1];
      // Build CSS gradient from sampled year colors
      const stops = years.map((y, i) => `${yearColor(y)} ${(i / (years.length - 1) * 100).toFixed(1)}%`).join(", ");
      const bar = document.createElement("div");
      bar.style.cssText = `width:160px;height:10px;border-radius:5px;background:linear-gradient(to right,${stops});flex-shrink:0`;
      const labelEl = document.createElement("span");
      labelEl.style.cssText = "font-size:11px;color:#8892a4;white-space:nowrap";
      labelEl.textContent = `${first} → ${last}`;
      const wrap = document.createElement("div");
      wrap.className = "legend-item";
      wrap.appendChild(bar);
      wrap.appendChild(labelEl);
      el.appendChild(wrap);
      // Multi-year chip
      const multi = document.createElement("div");
      multi.className = "legend-item";
      multi.innerHTML = `<div class="legend-dot" style="background:${MULTI_COLOR}"></div><span>Multi-year</span>`;
      el.appendChild(multi);
    } else if (state.colorBy === "role") {
      for (const [r, c] of Object.entries(ROLE_COLORS)) {
        const item = document.createElement("div");
        item.className = "legend-item";
        item.innerHTML = `<div class="legend-dot" style="background:${c}"></div><span>${r.charAt(0).toUpperCase() + r.slice(1)}</span>`;
        el.appendChild(item);
      }
    } else if (state.colorBy === "domain") {
      // Top subfields get named swatches; the long tail is "Other".
      for (const { name, color } of legendDomains) {
        const item = document.createElement("div");
        item.className = "legend-item";
        item.innerHTML = `<div class="legend-dot" style="background:${color}"></div><span>${name}</span>`;
        el.appendChild(item);
      }
      const other = document.createElement("div");
      other.className = "legend-item";
      other.innerHTML = `<div class="legend-dot" style="background:${OTHER_COLOR}"></div><span>${OTHER_DOMAIN}</span>`;
      el.appendChild(other);
    } else {
      for (const [label, t] of [["Low", 0], ["Mid", 0.5], ["High", 1]]) {
        const item = document.createElement("div");
        item.className = "legend-item";
        item.innerHTML = `<div class="legend-dot" style="background:${d3.interpolateViridis(t)}"></div><span>${label} connections</span>`;
        el.appendChild(item);
      }
    }

    // Edge-type key — which layer(s) are currently drawn.
    const edgeItems = [];
    if (state.edgeMode !== "collab") {
      edgeItems.push([ATTEND_COLOR, "Co-attendance"]);
    }
    if (state.edgeMode !== "attend" && HAS_COLLABS) {
      edgeItems.push([COLLAB_COLOR, "Co-authorship"]);
    }
    for (const [color, label] of edgeItems) {
      const item = document.createElement("div");
      item.className = "legend-item";
      item.innerHTML = `<div class="legend-line" style="background:${color}"></div><span>${label}</span>`;
      el.appendChild(item);
    }

    // In 3D, say so when the co-attendance layer is too big to draw in full.
    if (state.view === "3d" && attendCount > MAX_ATTEND_LINKS_3D) {
      const note = document.createElement("div");
      note.className = "legend-item legend-note";
      note.textContent = `Co-attendance lines (${attendCount.toLocaleString()}) are drawn for the selected person`;
      el.appendChild(note);
    }
  }

  // ── Update header stats ─────────────────────
  function updateStats(nodes, links) {
    document.getElementById("statNodes").textContent = nodes.length;
    document.getElementById("statEdges").textContent = links.length;
    document.getElementById("statYears").textContent = MCN_DATA.years.length;
  }

  // ── Main render ────────────────────────────
  // Rebuild the graph data for the current filters, then hand it to whichever
  // view is showing. Both views get fresh node/link objects every time, so
  // neither engine sees positions or pins left behind by the other.
  function render() {
    const yearFilter = state.selectedYears.has("all") ? "all" : [...state.selectedYears][0];
    const { nodes, links } = buildGraphData(yearFilter, state.selectedRole);
    allNodes = nodes;
    allLinks = links;
    attendCount = links.reduce((k, l) => k + (l.type === "attend" ? 1 : 0), 0);
    updateStats(nodes, links);
    renderLegend();
    if (state.view === "3d") render3d(nodes, links);
    else render2d(nodes, links);
  }

  // ── 2D (SVG) render ────────────────────────
  function render2d(nodes, links) {
    const W = width(), H = height();

    // Clear old SVG content
    svg.selectAll("*").remove();

    // Arrow marker
    svg.append("defs").append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -4 8 8")
      .attr("refX", 14).attr("refY", 0)
      .attr("markerWidth", 6).attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
        .attr("d", "M0,-4L8,0L0,4")
        .attr("fill", "rgba(255,255,255,0.2)");

    const g = svg.append("g");

    // Zoom behaviour
    const zoom = d3.zoom()
      .scaleExtent([0.1, 8])
      .on("zoom", e => g.attr("transform", e.transform));
    svg.call(zoom);

    // Links — co-authorship edges are brighter/thicker so they read on top of
    // the fainter co-attendance mesh.
    linkSel = g.append("g").attr("class", "links")
      .selectAll("line")
      .data(links)
      .join("line")
        .attr("class", d => "link " + d.type)
        .attr("stroke", linkColor)
        .attr("stroke-width", d => d.type === "collab"
          ? Math.sqrt(d.weight) * 1.2 + 0.6
          : Math.sqrt(d.weight) * 0.7 + 0.3)
        .attr("stroke-opacity", d => d.type === "collab" ? 0.6 : 0.15);

    // Nodes
    nodeSel = g.append("g").attr("class", "nodes")
      .selectAll(".node")
      .data(nodes, d => d.id)
      .join("g")
        .attr("class", "node")
        .attr("data-id", d => d.id)
        .call(
          d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended)
        )
        .on("click", (event, d) => {
          event.stopPropagation();
          selectNode(d);
        })
        .on("mouseover", (event, d) => showTooltip(event, d))
        .on("mousemove", (event) => moveTooltip(event))
        .on("mouseout", hideTooltip);

    nodeSel.append("circle")
      .attr("r", d => ROLE_RADIUS[d.primaryRole] || 7)
      .attr("fill", d => nodeColor(d))
      .attr("stroke", d => {
        const c = nodeColor(d);
        return d3.color(c) ? d3.color(c).brighter(1).toString() : "#fff";
      })
      .attr("stroke-width", 1.5)
      .attr("fill-opacity", 0.85);

    nodeSel.append("text")
      .attr("dy", d => (ROLE_RADIUS[d.primaryRole] || 7) + 11)
      .attr("text-anchor", "middle")
      .text(d => {
        // Show last name only if too crowded, full name if director/faculty
        if (d.primaryRole === "director" || d.primaryRole === "faculty") return d.name;
        const parts = d.name.split(" ");
        return parts[parts.length - 1];
      })
      .attr("font-size", d => d.primaryRole === "student" ? "9px" : "10px")
      .attr("fill", "rgba(255,255,255,0.75)");

    // Force simulation
    if (simulation) simulation.stop();
    simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links)
        .id(d => d.id)
        .distance(d => {
          const base = 60;
          // Weaker link distance for same-year connections
          return base - (d.weight - 1) * 5;
        })
        .strength(0.3)
      )
      .force("charge", d3.forceManyBody().strength(d => {
        const r = ROLE_RADIUS[d.primaryRole] || 7;
        return -(r * r * 4);
      }))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collision", d3.forceCollide(d => (ROLE_RADIUS[d.primaryRole] || 7) + 6))
      .alpha(1)
      .on("tick", ticked);

    // Layout overrides
    if (state.layout === "radial") {
      applyRadialLayout(nodes, links, W, H);
    } else if (state.layout === "domains") {
      applyDomainLayout(nodes, W, H);
    }

    // Click outside to deselect
    svg.on("click", () => {
      clearSelection();
      closeDetail();
    });

    applySearch();
  }

  function ticked() {
    if (!linkSel || !nodeSel) return;
    linkSel
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);
    nodeSel.attr("transform", d => `translate(${d.x},${d.y})`);
  }

  // ── Drag ───────────────────────────────────
  function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x; d.fy = d.y;
  }
  function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
  function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null; d.fy = null;
  }

  // ── Radial layout ──────────────────────────
  function applyRadialLayout(nodes, links, W, H) {
    simulation.stop();
    const R = Math.min(W, H) * 0.38;
    const cx = W / 2, cy = H / 2;
    // Group by primary year
    const yearGroups = {};
    for (const n of nodes) {
      const y = [...n.years][0] || "multi";
      if (!yearGroups[y]) yearGroups[y] = [];
      yearGroups[y].push(n);
    }
    let arcStart = 0;
    for (const [yr, grp] of Object.entries(yearGroups)) {
      const arcLen = (2 * Math.PI * grp.length) / nodes.length;
      grp.forEach((n, i) => {
        const angle = arcStart + (i / grp.length) * arcLen;
        n.x = cx + R * Math.cos(angle);
        n.y = cy + R * Math.sin(angle);
        n.fx = n.x; n.fy = n.y;
      });
      arcStart += arcLen;
    }
    ticked();
    // Release after a tick so dragging still works
    setTimeout(() => {
      for (const n of nodes) { n.fx = null; n.fy = null; }
    }, 100);
  }

  // ── Domain-cluster layout ──────────────────
  // Each research domain gets an anchor on a ring; nodes are pulled toward
  // their domain's anchor with forceX/forceY, so groups cluster but stay
  // draggable and physics-driven (unlike the fixed radial layout).
  function applyDomainLayout(nodes, W, H) {
    if (!simulation) return;
    // Stable anchor per domain label (top domains + "Other").
    const labels = [...legendDomains.map(d => d.name), OTHER_DOMAIN];
    const anchors = {};
    const R = Math.min(W, H) * 0.40;
    const cx = W / 2, cy = H / 2;
    labels.forEach((label, i) => {
      const angle = (i / labels.length) * 2 * Math.PI;
      anchors[label] = { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) };
    });
    const anchorFor = n => {
      const dom = domainOf(n.id);
      return anchors[dom] || anchors[OTHER_DOMAIN];
    };
    simulation
      .force("x", d3.forceX(n => anchorFor(n).x).strength(0.25))
      .force("y", d3.forceY(n => anchorFor(n).y).strength(0.25))
      .force("center", null)
      .alpha(0.9).restart();
  }

  // Remove the domain-cluster forces (used when leaving that layout).
  function clearDomainLayout(W, H) {
    if (!simulation) return;
    simulation
      .force("x", null)
      .force("y", null)
      .force("center", d3.forceCenter(W / 2, H / 2));
  }

  // ── 3D view (3d-force-graph, WebGL) ────────
  // One ForceGraph3D instance is made on first use and kept for the life of
  // the page (going back to 2D only pauses it), since browsers cap how many
  // WebGL contexts a page may open. It runs its own force simulation
  // (d3-force-3d) on the same node and link objects the 2D view would get.
  let graph3d = null;
  let lib3dPromise = null;   // the library load, shared by every caller
  let render3dToken = 0;     // id of the newest 3D render; stale async work checks it
  let center3d = null;       // the engine's own centering force, kept so layouts can restore it
  let cameraMoved3d = false; // the reader has taken the camera: stop auto-framing
  let lastFrame3d = 0;       // when the camera last re-framed a moving layout
  let emphasis3d = null;     // ids drawn at full strength, or null for everyone
  let hovered3d = null;
  let pointer3d = { clientX: 0, clientY: 0 }; // last pointer position, for the tooltip
  let searchFrameTimer = null;
  let noticeTimer = null;

  const radius3d = n => (ROLE_RADIUS[n.primaryRole] || 7) * NODE_SCALE_3D;
  const ORIGIN_3D = { x: 0, y: 0, z: 0 };

  // Size the 3D canvas to the graph area. Never 0: a zero height makes the
  // camera's aspect ratio 0/0, and one NaN there poisons every later camera
  // move (it happens when the page loads in a hidden or collapsed frame).
  function size3d() {
    graph3d.width(Math.max(1, width())).height(Math.max(1, height()));
  }

  function webglAvailable() {
    try {
      const c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
    } catch (e) {
      return false;
    }
  }

  // Load 3d-force-graph from #graph3d's data-lib URL: the CDN in development,
  // the vendored copy in a built bundle. Resolves at once if already loaded.
  function load3dLibrary() {
    if (window.ForceGraph3D) return Promise.resolve();
    if (!lib3dPromise) {
      lib3dPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = document.getElementById("graph3d").dataset.lib;
        s.onload = resolve;
        s.onerror = () => { lib3dPromise = null; reject(new Error("3D library failed to load")); };
        document.head.appendChild(s);
      });
    }
    return lib3dPromise;
  }

  function create3d() {
    const el = document.getElementById("graph3d");
    const g = ForceGraph3D({ controlType: "orbit" })(el)
      .backgroundColor("rgba(0,0,0,0)")   // let the page background show through
      .showNavInfo(false)
      .nodeId("id")
      .nodeLabel(() => "")                // hovering uses the page's own tooltip
      .linkLabel(() => "")
      .nodeRelSize(1)
      .nodeVal(n => Math.pow(radius3d(n), 3)) // a volume, so each sphere's radius is radius3d(n)
      .nodeResolution(12)
      .nodeOpacity(0.92)
      .nodeColor(nodeColor3d)
      .linkOpacity(1)                     // per-link opacity rides in linkColor3d's alpha
      .linkColor(linkColor3d)
      .linkWidth(linkWidth3d)
      .linkVisibility(linkVisible3d)
      .onNodeHover(hover3d)
      .onNodeClick(n => selectNode(n))
      .onBackgroundClick(() => { clearSelection(); closeDetail(); })
      .onEngineTick(followLayout3d)
      .onEngineStop(() => frame3d())
      .warmupTicks(REDUCE_MOTION ? 300 : 0)
      .cooldownTime(REDUCE_MOTION ? 0 : 12000);

    center3d = g.d3Force("center");

    // Any orbit, pan or zoom hands the camera to the reader.
    el.addEventListener("pointerdown", () => { cameraMoved3d = true; });
    el.addEventListener("wheel", () => { cameraMoved3d = true; }, { passive: true });
    el.addEventListener("pointermove", e => {
      pointer3d = e;
      if (hovered3d) moveTooltip(e);
    }, { passive: true });
    el.addEventListener("pointerleave", () => { hovered3d = null; hideTooltip(); });
    return g;
  }

  function render3d(nodes, links) {
    const token = ++render3dToken;
    setHint3d();
    load3dLibrary().then(() => {
      if (token !== render3dToken || state.view !== "3d") return; // superseded meanwhile
      if (!graph3d) graph3d = create3d();
      size3d();
      tuneForces3d();
      emphasis3d = currentEmphasis();
      graph3d.graphData({ nodes, links });
      apply3dLayout();
      graph3d.resumeAnimation();
      cameraMoved3d = false;
      frameSearch3d(searchHits());
    }).catch(err => {
      if (token !== render3dToken) return;
      console.error(err);
      showNotice("The 3D view couldn't start in this browser, so here is the 2D view.");
      setView("2d");
    });
  }

  // The 2D simulation's spring lengths and repulsion, so both views spread
  // the network alike. Two differences: lengths are floored (2D's formula
  // turns negative past a dozen shared papers), and repulsion stops at a
  // range, or the whole network would push its unlinked members far out and
  // the camera, framing everyone, would shrink the linked core to a speck.
  function tuneForces3d() {
    graph3d.d3Force("link")
      .distance(l => Math.max(15, 60 - (l.weight - 1) * 5))
      .strength(0.3);
    graph3d.d3Force("charge")
      .strength(n => {
        const r = ROLE_RADIUS[n.primaryRole] || 7;
        return -(r * r * 4);
      })
      .distanceMax(300);
  }

  // ── 3D styling ──
  // The 2D view fades things with CSS classes; WebGL materials can't read
  // those, so in 3D the fade is the alpha of each node's and link's color.

  // Who is in focus: the selected person and their neighbours, else the
  // search hits, else nobody in particular (null).
  function currentEmphasis() {
    return state.selectedNode ? neighborhoodOf(state.selectedNode.id) : searchHits();
  }

  // `color` with the given opacity, as rgba().
  function withAlpha(color, alpha) {
    const c = d3.color(color);
    if (!c) return color;
    c.opacity = alpha;
    return c.formatRgb();
  }

  function nodeColor3d(n) {
    const c = nodeColor(n);
    return emphasis3d && !emphasis3d.has(n.id) ? withAlpha(c, DIM_ALPHA_3D) : c;
  }

  function touchesSelection(l) {
    return !!state.selectedNode && endIds(l).includes(state.selectedNode.id);
  }

  // Opacities follow the 2D stylesheet: co-authorship reads above the fainter
  // co-attendance mesh; a selection lights the person's own links and fades
  // the rest; a search fades links with no matching end.
  function linkColor3d(l) {
    const base = linkColor(l);
    if (state.selectedNode) return withAlpha(base, touchesSelection(l) ? 0.95 : 0.04);
    if (emphasis3d) {
      const [s, t] = endIds(l);
      if (!emphasis3d.has(s) && !emphasis3d.has(t)) return withAlpha(base, 0.03);
    }
    return withAlpha(base, l.type === "collab" ? 0.6 : 0.15);
  }

  // 0 draws a cheap 1px line. The selected person's links become tubes,
  // co-authorship ones thicker the more papers the pair share.
  function linkWidth3d(l) {
    if (!touchesSelection(l)) return 0;
    return l.type === "collab" ? Math.sqrt(l.weight) * 0.5 + 0.5 : 0.4;
  }

  // See MAX_ATTEND_LINKS_3D: an oversized co-attendance layer is drawn only
  // around the selected person (hidden links still act on the layout).
  function linkVisible3d(l) {
    return l.type !== "attend" || attendCount <= MAX_ATTEND_LINKS_3D || touchesSelection(l);
  }

  // Re-read every style accessor so a change of selection, search or color
  // mode reaches the scene. Does nothing outside 3D.
  function restyle3d() {
    if (!graph3d || state.view !== "3d") return;
    emphasis3d = currentEmphasis();
    graph3d
      .nodeColor(graph3d.nodeColor())
      .linkColor(graph3d.linkColor())
      .linkWidth(graph3d.linkWidth())
      .linkVisibility(graph3d.linkVisibility());
  }

  function hover3d(n) {
    hovered3d = n || null;
    if (n) showTooltip(pointer3d, n);
    else hideTooltip();
  }

  // ── 3D camera ──
  // Frame everyone, unless the reader has taken the camera.
  function frame3d() {
    if (!graph3d || cameraMoved3d || state.view !== "3d") return;
    graph3d.zoomToFit(ms(600), 30);
  }

  // While a fresh layout spreads out, re-frame about once a second so the
  // camera follows it (frame3d steps aside once the reader takes over).
  function followLayout3d() {
    const now = performance.now();
    if (now - lastFrame3d < 1000) return;
    lastFrame3d = now;
    frame3d();
  }

  // Turn the camera onto `center`, keeping the current viewing direction and
  // backing off until `members` fit the view. The 90th-percentile distance
  // sets the reach, so one far-flung member doesn't drag the camera out.
  // Orbiting then pivots around `center`.
  function flyTo3d(center, members) {
    if (!graph3d || !Number.isFinite(center.x)) return;
    const dists = members.filter(n => Number.isFinite(n.x))
      .map(n => Math.hypot(n.x - center.x, n.y - center.y, n.z - center.z))
      .sort((a, b) => a - b);
    const reach = dists.length ? dists[Math.floor(0.9 * (dists.length - 1))] : 0;
    // The camera sees 50° top to bottom: reach / tan(25°) ≈ 2.1 × reach, plus margin.
    const dist = Math.max(FOCUS_DISTANCE_3D, reach * 2.4);
    const cam = graph3d.camera().position;
    const dx = cam.x - center.x, dy = cam.y - center.y, dz = cam.z - center.z;
    const len = Math.hypot(dx, dy, dz);
    const [ux, uy, uz] = len > 1e-6 ? [dx / len, dy / len, dz / len] : [0, 0, 1];
    cameraMoved3d = true; // don't let auto-framing undo this
    graph3d.cameraPosition(
      { x: center.x + ux * dist, y: center.y + uy * dist, z: center.z + uz * dist },
      { x: center.x, y: center.y, z: center.z },
      ms(900));
  }

  // Look at a selected person, far enough back to see who they connect to.
  function focusPerson3d(d) {
    const ids = neighborhoodOf(d.id);
    flyTo3d(d, allNodes.filter(n => ids.has(n.id)));
  }

  // Swing round to whoever the search matched, after a pause so the camera
  // isn't chasing every keystroke.
  function frameSearch3d(hits) {
    clearTimeout(searchFrameTimer);
    if (!graph3d || !hits || !hits.size) return;
    searchFrameTimer = setTimeout(() => {
      if (state.view !== "3d") return;
      const group = allNodes.filter(n => hits.has(n.id) && Number.isFinite(n.x));
      if (!group.length) return;
      const mean = axis => group.reduce((s, n) => s + n[axis], 0) / group.length;
      flyTo3d({ x: mean("x"), y: mean("y"), z: mean("z") }, group);
    }, 400);
  }

  // ── 3D layouts ──
  // Each layout is a few extra forces on the 3D engine's simulation, so people
  // stay draggable and keep settling under their links, as in 2D.

  // Pull each node toward a target point; any axis the target omits is free.
  function forceToward(targetOf, strength) {
    let nodes = [];
    function force(alpha) {
      const k = strength * alpha;
      for (const n of nodes) {
        const t = targetOf(n);
        if (!t) continue;
        if (t.x !== undefined) n.vx += (t.x - n.x) * k;
        if (t.y !== undefined) n.vy += (t.y - n.y) * k;
        if (t.z !== undefined) n.vz += (t.z - n.z) * k;
      }
    }
    force.initialize = ns => { nodes = ns; };
    return force;
  }

  // Pull each node toward a circle of the given radius around the vertical axis.
  function forceRing(radius, strength) {
    let nodes = [];
    function force(alpha) {
      for (const n of nodes) {
        const r = Math.hypot(n.x, n.z) || 1e-6;
        const k = ((radius - r) / r) * strength * alpha;
        n.vx += n.x * k;
        n.vz += n.z * k;
      }
    }
    force.initialize = ns => { nodes = ns; };
    return force;
  }

  // "Radial" in 3D: one ring per cohort (people sit in their first MCN year),
  // stacked earliest-to-latest up the vertical axis, so the 2D ring of years
  // becomes a column to orbit. Links still pull collaborators to the same side.
  function cohortColumn3d(nodes) {
    const firstYear = new Map(nodes.map(n => [n.id, Math.min(...n.years)]));
    const years = [...firstYear.values()];
    const mid = (Math.min(...years) + Math.max(...years)) / 2;
    const perYear = new Map();
    for (const y of years) perYear.set(y, (perYear.get(y) || 0) + 1);
    const biggest = Math.max(1, ...perYear.values());
    return {
      ringRadius: Math.max(80, (biggest * 30) / (2 * Math.PI)), // ~30 units of rim per person
      heightOf: n => (firstYear.get(n.id) - mid) * 20,
    };
  }

  // "Domains" in 3D: each research domain's anchor is spread evenly over a
  // sphere (a golden-angle spiral), the 3D version of 2D's ring of anchors.
  function domainAnchors3d(count) {
    const labels = [...legendDomains.map(d => d.name), OTHER_DOMAIN];
    const R = 80 + 9 * Math.sqrt(count);
    const anchors = {};
    labels.forEach((label, i) => {
      const y = 1 - (2 * (i + 0.5)) / labels.length; // top to bottom, in (-1, 1)
      const r = Math.sqrt(1 - y * y);
      const theta = i * Math.PI * (3 - Math.sqrt(5)); // golden angle
      anchors[label] = { x: R * r * Math.cos(theta), y: R * y, z: R * r * Math.sin(theta) };
    });
    return anchors;
  }

  // Swap in the forces for state.layout.
  function apply3dLayout() {
    graph3d.d3Force("toward", null).d3Force("ring", null).d3Force("center", center3d);
    if (state.layout === "force") {
      // People with no links in view feel only repulsion and drift outward;
      // a weak pull to the origin keeps them as a halo round the linked core.
      graph3d.d3Force("toward", forceToward(() => ORIGIN_3D, 0.03));
    } else if (state.layout === "radial") {
      const { ringRadius, heightOf } = cohortColumn3d(allNodes);
      // The ring pull is strong enough to beat repulsion (which would spread
      // each cohort into a disc) but acts only radially, so people still slide
      // round their ring toward collaborators in other years.
      graph3d
        .d3Force("center", null) // the ring centres x/z, and years set y
        .d3Force("toward", forceToward(n => ({ y: heightOf(n) }), 0.5))
        .d3Force("ring", forceRing(ringRadius, 0.6));
    } else if (state.layout === "domains") {
      const anchors = domainAnchors3d(allNodes.length);
      graph3d
        .d3Force("center", null)
        .d3Force("toward", forceToward(n => anchors[domainOf(n.id)] || anchors[OTHER_DOMAIN], 0.25));
    }
  }

  // A layout button pressed while in 3D.
  function relayout3d() {
    setHint3d();
    if (!graph3d) return;
    apply3dLayout();
    cameraMoved3d = false;
    // With reduced motion the engine doesn't animate (cooldownTime 0), so
    // hand it the same data again to re-run its instant warm-up instead.
    if (REDUCE_MOTION) graph3d.graphData({ nodes: allNodes, links: allLinks });
    else graph3d.d3ReheatSimulation();
  }

  function setHint3d() {
    const how = "Drag to orbit · right-drag to pan · scroll to zoom";
    const what = {
      radial:  "One ring per cohort, earliest at the bottom",
      domains: "One cluster per research domain",
    }[state.layout];
    document.getElementById("hint3d").textContent = what ? `${what} · ${how}` : how;
  }

  // A short-lived message over the graph.
  function showNotice(text) {
    const el = document.getElementById("viewNotice");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { el.hidden = true; }, 6000);
  }

  // ── 2D / 3D switch ─────────────────────────
  function setView(view) {
    // Checked only when 3D is asked for, so the 2D page never opens a WebGL
    // context it doesn't need.
    if (view === "3d" && !webglAvailable()) {
      const btn3d = document.querySelector('#viewPills [data-view="3d"]');
      if (btn3d) {
        btn3d.disabled = true;
        btn3d.title = "3D needs WebGL, which this browser has turned off";
      }
      showNotice("3D needs WebGL, which this browser has turned off.");
      view = "2d";
    }
    state.view = view;
    document.querySelectorAll("#viewPills .role-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.view === view));
    // Keep the URL in step, so a 3D view can be shared as …#3d. The path is
    // absolute because a deployed page may carry a <base> tag.
    history.replaceState(null, "", location.pathname + location.search + (view === "3d" ? "#3d" : ""));
    clearSelection(); closeDetail(); hideTooltip();

    const is3d = view === "3d";
    document.getElementById("graph").style.display = is3d ? "none" : "";
    document.getElementById("graph3d").hidden = !is3d;
    document.getElementById("hint3d").hidden = !is3d;
    if (is3d) {
      // Park the 2D view: stop its simulation and drop its SVG.
      if (simulation) simulation.stop();
      svg.selectAll("*").remove();
      linkSel = nodeSel = null;
    } else if (graph3d) {
      graph3d.pauseAnimation(); // keep the WebGL context, just stop drawing
    }
    render();
  }

  // ── Tooltip ────────────────────────────────
  function showTooltip(event, d) {
    const tip = document.getElementById("tooltip");
    tip.classList.remove("hidden");
    const career = CAREER_INFO[d.name] || null;
    const yearChips = [...d.years].sort().map(y => {
      const yc = yearColor(y);
      return `<span class="tooltip-year-chip" style="background:${yc}22;color:${yc};border:1px solid ${yc}44">${y}</span>`;
    }).join("");
    let collabCount = 0;
    if (COLLABS && COLLABS.edges) {
      for (const e of COLLABS.edges) {
        if (e.source === d.id || e.target === d.id) collabCount++;
      }
    }
    const domain = domainOf(d.id);
    tip.innerHTML = `
      <div class="tooltip-name">${d.name}</div>
      <div class="tooltip-meta">
        <b style="color:${ROLE_COLORS[d.primaryRole]}">${d.primaryRole}</b>
        ${career ? ` · ${career.affiliation}` : ""}
      </div>
      ${domain ? `<div class="tooltip-meta"><span style="color:${subfieldColor(domain)}">◆</span> ${domain}</div>` : ""}
      <div class="tooltip-meta">${d.degree} connection${d.degree !== 1 ? "s" : ""}${
        HAS_COLLABS ? ` · ${collabCount} co-author${collabCount !== 1 ? "s" : ""}` : ""
      }</div>
      <div class="tooltip-years">${yearChips}</div>
    `;
    moveTooltip(event);
  }

  function moveTooltip(event) {
    const tip = document.getElementById("tooltip");
    const pad = 14;
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + 250 > window.innerWidth)  x = event.clientX - 250 - pad;
    if (y + 140 > window.innerHeight) y = event.clientY - 140 - pad;
    tip.style.left = x + "px";
    tip.style.top  = y + "px";
  }

  function hideTooltip() {
    document.getElementById("tooltip").classList.add("hidden");
  }

  // ── Node selection & detail panel ──────────
  function selectNode(d) {
    state.selectedNode = d;
    highlightNeighbors(d);
    if (state.view === "3d") focusPerson3d(d);
    openDetail(d);
  }

  function highlightNeighbors(d) {
    if (state.view === "3d") { restyle3d(); return; }
    if (!nodeSel || !linkSel) return;
    const neighborIds = neighborhoodOf(d.id);
    const touches = l => endIds(l).includes(d.id);
    nodeSel
      .classed("highlighted", n => n.id === d.id)
      .classed("dimmed",      n => !neighborIds.has(n.id));
    linkSel
      .classed("highlighted", l => touches(l))
      .classed("dimmed",      l => !touches(l));
  }

  function clearSelection() {
    state.selectedNode = null;
    restyle3d();
    if (!nodeSel || !linkSel) return;
    nodeSel.classed("highlighted dimmed search-hit", false);
    linkSel.classed("highlighted dimmed", false);
  }

  function openDetail(d) {
    const panel = document.getElementById("detailPanel");
    const career = CAREER_INFO[d.name] || null;
    const initials = d.name.split(" ").map(p => p[0]).slice(0,2).join("");
    const color = nodeColor(d);

    // Per-year role a person held that year. Roster arrays store the RAW
    // scraped spelling for that year (which can differ from this person's
    // canonical name — e.g. "Terrance Sejnowski" in the 90s vs. the canonical
    // "Terrence J Sejnowski"), so membership must be checked through canon(),
    // not by comparing raw strings directly against d.name.
    const has = (arr, name) => (arr || []).some(n => canon(n) === name);
    const yearsRows = [...d.years].sort().map(y => {
      let role = "Student";
      const cohort = MCN_DATA.cohorts[y];
      if (cohort) {
        if (has(cohort.directors, d.name)) role = "Director";
        else if (has(cohort.faculty, d.name)) role = "Faculty";
        else if (has(cohort.lecturers, d.name)) role = "Lecturer";
        else if (has(cohort.tas, d.name)) role = "TA";
      }
      return `<div class="detail-year-row">
        <div class="detail-year-dot" style="background:${yearColor(y)}"></div>
        <span class="detail-year-label">MCN ${y}</span>
        <span class="detail-year-role">${role}</span>
      </div>`;
    }).join("");

    // Co-authors of this person (independent of the active edge layer), with
    // shared-paper counts, sorted by how much they've published together.
    const collaborators = [];
    if (COLLABS && COLLABS.edges) {
      const nameSet = new Set(allNodes.map(n => n.id));
      for (const e of COLLABS.edges) {
        let other = null;
        if (e.source === d.id) other = e.target;
        else if (e.target === d.id) other = e.source;
        if (other && nameSet.has(other)) collaborators.push({ name: other, papers: e.papers });
      }
      collaborators.sort((a, b) => b.papers - a.papers);
    }

    // Each row: the co-author's name (click → jump to their node, as
    // elsewhere in this panel) and their paper count (click → expand a list
    // of the papers they share, pulled from the cached sample titles).
    const COLLABS_VISIBLE = 8;
    function collabRowHtml(c) {
      const key = [d.id, c.name].sort().join("|||");
      const edge = collabPairMap.get(key);
      const titles = (edge && edge.sampleTitles) || [];
      const shownHtml = titles.map(t =>
        `<div class="detail-collab-paper">${t.title}${t.year ? ` <span class="detail-collab-paper-year">(${t.year})</span>` : ""}</div>`
      ).join("");
      const remaining = c.papers - titles.length;
      const moreHtml = remaining > 0
        ? `<div class="detail-collab-paper detail-collab-paper-more">+ ${remaining} more paper${remaining !== 1 ? "s" : ""} not shown</div>`
        : "";
      const body = shownHtml || moreHtml
        ? shownHtml + moreHtml
        : `<div class="detail-collab-paper detail-collab-paper-more">No titles cached for this pair</div>`;
      return `<div class="detail-collab-row">
        <a onclick="window.__mcnSelectById('${c.name.replace(/'/g, "\\'")}')" style="color:${COLLAB_COLOR}">${c.name}</a>
        <span class="detail-collab-count" title="Click to see shared papers"
              onclick="this.nextElementSibling.classList.toggle('open')">${c.papers}</span>
        <div class="detail-collab-papers">${body}</div>
      </div>`;
    }
    const collabRowsVisible = collaborators.slice(0, COLLABS_VISIBLE).map(collabRowHtml).join("");
    const collabHidden = collaborators.slice(COLLABS_VISIBLE);
    const collabRowsHidden = collabHidden.map(collabRowHtml).join("");
    const collabToggle = collabHidden.length
      ? `<a class="detail-collab-toggle" data-more-count="${collabHidden.length}" onclick="
          var box = this.previousElementSibling;
          var opening = box.style.display !== 'block';
          box.style.display = opening ? 'block' : 'none';
          this.textContent = opening ? 'Show less' : ('+ ' + this.dataset.moreCount + ' more');
        ">+ ${collabHidden.length} more</a>`
      : "";

    // Scholarly identity links, when this person was resolved.
    const ident = RESOLVED[d.name] || null;
    const identLinks = [];
    if (ident) {
      if (ident.openalex) identLinks.push(`<a href="https://openalex.org/${ident.openalex}" target="_blank">OpenAlex</a>`);
      if (ident.orcid)    identLinks.push(`<a href="https://orcid.org/${ident.orcid}" target="_blank">ORCID</a>`);
    }

    // Research areas (primary domain + top topics), when available.
    const domainInfo = (HAS_DOMAINS && DOMAINS.byPerson[d.name]) || null;
    const domain = domainInfo && domainInfo.domain;
    const topicChips = (domainInfo && domainInfo.topics || []).map(t =>
      `<span class="detail-topic-chip">${t}</span>`).join("");

    const neighborIds = neighborhoodOf(d.id);
    const neighborNodes = allNodes.filter(n => n.id !== d.id && neighborIds.has(n.id));
    // Sort by role priority
    const pri = { director:0, faculty:1, lecturer:2, ta:3, student:4 };
    neighborNodes.sort((a, b) => (pri[a.primaryRole]||5) - (pri[b.primaryRole]||5));
    const neighborList = neighborNodes.slice(0, 8).map(n =>
      `<a onclick="window.__mcnSelectById('${n.id}')" style="color:${ROLE_COLORS[n.primaryRole]||'#aaa'}">${n.name}</a>`
    ).join(", ");
    const extra = neighborNodes.length > 8 ? ` + ${neighborNodes.length - 8} more` : "";

    document.getElementById("detailContent").innerHTML = `
      <div class="detail-avatar" style="background:${color}22;border:1px solid ${color}44;color:${color}">${initials}</div>
      <div class="detail-name">${d.name}</div>
      <span class="detail-role-badge" style="background:${ROLE_COLORS[d.primaryRole]}22;color:${ROLE_COLORS[d.primaryRole]};border:1px solid ${ROLE_COLORS[d.primaryRole]}44">${d.primaryRole}</span>

      ${career ? `
      <div class="detail-section">
        <div class="detail-section-title">Current position</div>
        <div class="detail-career-box">
          <div class="detail-career-institution">${career.affiliation}</div>
          <div class="detail-career-role">${career.role}</div>
        </div>
      </div>` : ""}

      ${domain ? `
      <div class="detail-section">
        <div class="detail-section-title">Research areas</div>
        <div class="detail-domain" style="color:${subfieldColor(domain)}">◆ ${domain}</div>
        ${topicChips ? `<div class="detail-topics">${topicChips}</div>` : ""}
      </div>` : ""}

      ${identLinks.length ? `
      <div class="detail-section">
        <div class="detail-section-title">Scholarly profile</div>
        <div class="detail-ident-links">${identLinks.join(" · ")}</div>
      </div>` : ""}

      <div class="detail-section">
        <div class="detail-section-title">MCN appearances</div>
        ${yearsRows}
      </div>

      ${collaborators.length > 0 ? `
      <div class="detail-section">
        <div class="detail-section-title">Co-authors (${collaborators.length})</div>
        <div class="detail-collabs">${collabRowsVisible}</div>
        <div class="detail-collabs detail-collabs-hidden">${collabRowsHidden}</div>
        ${collabToggle}
      </div>` : ""}

      ${neighborNodes.length > 0 ? `
      <div class="detail-section">
        <div class="detail-section-title">Connected to (${neighborNodes.length})</div>
        <div class="detail-connections">${neighborList}${extra}</div>
      </div>` : ""}
    `;

    panel.classList.remove("hidden");
    setTimeout(() => panel.classList.add("visible"), 10);
  }

  function closeDetail() {
    const panel = document.getElementById("detailPanel");
    panel.classList.remove("visible");
  }

  // Global hook for clicking neighbor names
  window.__mcnSelectById = function(id) {
    const node = allNodes.find(n => n.id === id);
    if (node) selectNode(node);
  };

  // ── Search ─────────────────────────────────
  function applySearch() {
    const hits = searchHits();
    if (state.view === "3d") {
      restyle3d();
      frameSearch3d(hits);
      return;
    }
    if (!nodeSel) return;
    if (!hits) {
      nodeSel.classed("search-hit dimmed", false);
      linkSel.classed("dimmed", false);
      return;
    }
    nodeSel
      .classed("search-hit", n => hits.has(n.id))
      .classed("dimmed",     n => !hits.has(n.id));
    linkSel.classed("dimmed", l => {
      const [s, t] = endIds(l);
      return !hits.has(s) && !hits.has(t);
    });
  }

  // ── Year buttons ────────────────────────────────
  function buildYearButtons() {
    const container = document.getElementById("yearPills");
    const allBtn = document.createElement("button");
    allBtn.className = "year-btn active";
    allBtn.dataset.year = "all";
    allBtn.textContent = "All";
    allBtn.style.background = "#4f46e5";
    allBtn.onclick = () => setYearFilter("all");
    container.appendChild(allBtn);

    for (const y of [...MCN_DATA.years].sort()) {
      const btn = document.createElement("button");
      btn.className = "year-btn";
      btn.dataset.year = String(y);
      btn.textContent = String(y);
      btn.onclick = () => setYearFilter(String(y));
      container.appendChild(btn);
    }
  }

  function setYearFilter(year) {
    document.querySelectorAll(".year-btn").forEach(b => b.classList.remove("active"));
    document.querySelector(`.year-btn[data-year="${year}"]`).classList.add("active");
    state.selectedYears = year === "all" ? new Set(["all"]) : new Set([year]);
    clearSelection(); closeDetail();
    render();
  }

  // ── Role buttons ───────────────────────────
  function initRoleButtons() {
    document.querySelectorAll("#rolePills .role-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.role === state.selectedRole);
      btn.onclick = () => {
        document.querySelectorAll("#rolePills .role-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.selectedRole = btn.dataset.role;
        clearSelection(); closeDetail();
        render();
      };
    });
  }

  // ── Edge-mode buttons ──────────────────────
  function initEdgeModeButtons() {
    const pills = document.getElementById("edgeModePills");
    if (!pills) return;
    // Reflect the default (and disable the co-authorship option when there's
    // no data for it) before wiring up clicks.
    pills.querySelectorAll(".role-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.edgemode === state.edgeMode);
      if (b.dataset.edgemode !== "attend" && !HAS_COLLABS) {
        b.disabled = true;
        b.title = "Run enrich_collabs.py to generate co-authorship edges";
      }
    });
    pills.querySelectorAll(".role-btn").forEach(btn => {
      btn.onclick = () => {
        if (btn.disabled) return;
        pills.querySelectorAll(".role-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.edgeMode = btn.dataset.edgemode;
        clearSelection(); closeDetail();
        render();
      };
    });
  }

  // ── Color-by buttons ───────────────────────
  function initColorByButtons() {
    document.querySelectorAll("#colorByPills .role-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.colorby === state.colorBy);
      btn.onclick = () => {
        document.querySelectorAll("#colorByPills .role-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.colorBy = btn.dataset.colorby;
        // Re-color nodes in place (no full re-render needed)
        if (nodeSel) {
          nodeSel.select("circle")
            .attr("fill", d => nodeColor(d))
            .attr("stroke", d => {
              const c = nodeColor(d);
              return d3.color(c) ? d3.color(c).brighter(1).toString() : "#fff";
            });
        }
        restyle3d();
        renderLegend();
      };
    });
  }

  // ── Layout buttons ─────────────────────────
  function initLayoutButtons() {
    const btns = {
      force:   document.getElementById("btnForce"),
      radial:  document.getElementById("btnRadial"),
      domains: document.getElementById("btnDomains"),
    };
    const setActive = mode => {
      for (const [k, b] of Object.entries(btns)) {
        if (b) b.classList.toggle("active", k === mode);
      }
    };
    // In 3D each button swaps the 3D engine's layout forces instead.
    btns.force.onclick = () => {
      state.layout = "force";
      setActive("force");
      if (state.view === "3d") { relayout3d(); return; }
      clearDomainLayout(width(), height());
      if (allNodes) allNodes.forEach(n => { n.fx = null; n.fy = null; });
      if (simulation) simulation.alpha(0.8).restart();
    };
    btns.radial.onclick = () => {
      state.layout = "radial";
      setActive("radial");
      if (state.view === "3d") { relayout3d(); return; }
      clearDomainLayout(width(), height());
      if (allNodes && allLinks) applyRadialLayout(allNodes, allLinks, width(), height());
    };
    if (btns.domains) {
      btns.domains.disabled = !HAS_DOMAINS;
      if (!HAS_DOMAINS) btns.domains.title = "Run enrich_domains.py to enable";
      btns.domains.onclick = () => {
        if (btns.domains.disabled) return;
        state.layout = "domains";
        setActive("domains");
        if (state.view === "3d") { relayout3d(); return; }
        if (allNodes) allNodes.forEach(n => { n.fx = null; n.fy = null; });
        applyDomainLayout(allNodes, width(), height());
      };
    }
  }

  // ── Domain filter (research-area dropdown) ──
  function initDomainFilter() {
    const sel = document.getElementById("domainFilter");
    if (!sel) return;
    if (!HAS_DOMAINS || !DOMAINS.subfields) {
      sel.disabled = true;
      sel.title = "Run enrich_domains.py to enable";
      return;
    }
    for (const s of DOMAINS.subfields) {
      const opt = document.createElement("option");
      opt.value = s.name;
      opt.textContent = `${s.name} (${s.count})`;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => {
      state.selectedDomain = sel.value;
      clearSelection(); closeDetail();
      render();
    });
  }

  // Disable the Domain color pill when there's no domain data.
  function initDomainColorPill() {
    const btn = document.querySelector('#colorByPills [data-colorby="domain"]');
    if (btn && !HAS_DOMAINS) {
      btn.disabled = true;
      btn.title = "Run enrich_domains.py to enable";
    }
  }

  // ── View (2D / 3D) buttons ─────────────────
  function initViewButtons() {
    const pills = document.getElementById("viewPills");
    if (!pills) return;
    pills.querySelectorAll(".role-btn").forEach(btn => {
      btn.onclick = () => {
        if (btn.disabled || btn.dataset.view === state.view) return;
        setView(btn.dataset.view);
      };
    });
  }

  // ── Search input ───────────────────────────
  function initSearch() {
    const inp = document.getElementById("searchInput");
    inp.addEventListener("input", () => {
      state.searchQuery = inp.value;
      clearSelection(); closeDetail();
      applySearch();
    });
    inp.addEventListener("keydown", e => {
      if (e.key === "Escape") { inp.value = ""; state.searchQuery = ""; applySearch(); }
    });
  }

  // ── Close detail panel ─────────────────────
  document.getElementById("closeDetail").onclick = () => {
    clearSelection(); closeDetail();
  };

  // ── Init ───────────────────────────────────
  function init() {
    svg = d3.select("#graph");

    buildYearButtons();
    initRoleButtons();
    initEdgeModeButtons();
    initColorByButtons();
    initDomainColorPill();
    initDomainFilter();
    initLayoutButtons();
    initViewButtons();
    initSearch();
    setView(state.view); // shows the right surface, then renders

    // Re-render on resize
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.view === "3d") {
          if (graph3d) size3d();
          return;
        }
        if (simulation) {
          simulation.force("center", d3.forceCenter(width() / 2, height() / 2));
          simulation.alpha(0.3).restart();
        }
      }, 200);
    });
  }

  // Run after DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
