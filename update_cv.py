import os
import re
import json
import PyPDF2

PDF_PATH = "/Users/mrugankdake/Documents/Personal/mindemory.github.io/docs/MrugankDakeCV.pdf"
OUTPUT_PATH = "/Users/mrugankdake/Documents/Personal/mindemory.github.io/cv_data.js"

def clean_text(text):
    text = text.replace("/gl⌢be", "")
    text = text.replace("/envel⌢pe", "")
    text = text.replace("/github", "")
    text = text.replace("♂¶ap-¶arker-alt", "")
    text = text.replace("ἾB", "")
    text = text.replace("/cer◎ifica◎e", "")
    text = text.replace("♂pen-nib", "")
    text = text.replace("/chalkboard-◎eacher", "")
    text = text.replace("ὒC", "")
    text = text.replace("ὋC", "")
    text = text.replace("/handshake", "")
    text = text.replace("Ἴ6", "")
    text = text.replace("/cogs", "")
    text = text.replace("˜", "~")
    text = re.sub(r'[ \t]+', ' ', text)
    return text.strip()

def split_poster_authors_title(text):
    starters = [
        "Working memory synchronizes",
        "Do perturbations to visual",
        "Perturbing human V1",
        "Li-Koff:",
        "CoCa coli:",
        "A tale of two cortices",
        "Neural synchrony between"
    ]
    for starter in starters:
        idx = text.find(starter)
        if idx > -1:
            authors = text[:idx].strip().rstrip(",. ")
            title = text[idx:].strip()
            return authors, title
    return "Dake M.", text

def main():
    if not os.path.exists(PDF_PATH):
        print(f"Error: PDF file not found at {PDF_PATH}")
        return

    reader = PyPDF2.PdfReader(PDF_PATH)
    
    # 1. Extract raw text from the pages using the default PDF reader method
    # This is highly robust for single-column texts and handles alignments correctly.
    full_raw_text = ""
    for page in reader.pages:
        full_raw_text += page.extract_text() + "\n"

    # 2. Extract coordinates on page 2 ONLY for the SKILLS section
    skills_elements = []
    page2 = reader.pages[1]
    
    def skills_visitor(text, cm, tm, fontDict, fontSize):
        x = tm[4]
        y = tm[5]
        # Split by newline inside text block to get accurate coords
        lines = text.split("\n")
        for i, line in enumerate(lines):
            if line.strip():
                skills_elements.append({
                    "text": line,
                    "x": x,
                    "y": y - (fontSize * i * 1.2)
                })
                
    page2.extract_text(visitor_text=skills_visitor)

    # Clean the full raw text to identify section splits
    headers = [
        ("academic", "ACADEMIC HISTORY"),
        ("specialized", "SPECIALIZED TRAINING"),
        ("publications", "PUBLICATIONS"),
        ("posters", "POSTERS & TALKS"),
        ("predoc", "PRE-DOCTORAL RESEARCH EXPERIENCE"),
        ("professional", "PROFESSIONAL & TEACHING EXPERIENCE"),
        ("service", "PROFESSIONAL SERVICE"),
        ("awards", "AWARDS"),
        ("skills", "SKILLS")
    ]

    indices = []
    for key, title in headers:
        match = re.search(re.escape(title), full_raw_text)
        if match:
            indices.append((key, match.start(), match.end()))
    
    indices.sort(key=lambda x: x[1])

    section_blocks = {}
    for i in range(len(indices)):
        key, start, end = indices[i]
        next_start = indices[i+1][1] if i + 1 < len(indices) else len(full_raw_text)
        section_blocks[key] = full_raw_text[end:next_start].strip()

    cv_data = {
        "name": "Mrugank Dake",
        "contact": {
            "website": "mindemory.io",
            "email": "mrugank.dake@dartmouth.edu",
            "github": "github.com/mindemory",
            "location": "Hanover, NH"
        }
    }

    # Helper function to group multiline list items starting with •
    def parse_bullet_items(section_text):
        items = []
        current_item = ""
        for line in section_text.split("\n"):
            line = clean_text(line)
            if not line:
                continue
            if line.startswith("•") or line.startswith("*"):
                if current_item:
                    items.append(current_item)
                current_item = line.lstrip("•* ").strip()
            else:
                if current_item:
                    # handle hyphenation
                    if current_item.endswith("-"):
                        current_item = current_item[:-1] + line
                    else:
                        current_item += " " + line
        if current_item:
            items.append(current_item)
        return items

    # 1. Parse Academic History
    academic_items = []
    if "academic" in section_blocks:
        lines = [l.strip() for l in section_blocks["academic"].split("\n") if l.strip()]
        current_item = None
        current_degree = None
        
        for line in lines:
            line_cleaned = clean_text(line)
            if not line_cleaned:
                continue
                
            is_inst = False
            for keyword in ["College", "University", "IISER", "Indian Institute"]:
                if keyword in line_cleaned:
                    is_inst = True
                    break
                    
            if is_inst:
                if current_item:
                    if current_degree:
                        current_item["degrees"].append(current_degree)
                        current_degree = None
                    academic_items.append(current_item)
                
                # Split location
                loc_match = re.search(r'(Hanover, NH|New York, NY|Tirupati, India|India)$', line_cleaned)
                location = ""
                inst_name = line_cleaned
                if loc_match:
                    location = loc_match.group(1)
                    inst_name = line_cleaned[:loc_match.start()].strip()
                    
                current_item = {
                    "institution": inst_name,
                    "location": location,
                    "degrees": []
                }
            elif current_item:
                is_degree = False
                for deg_keyword in ["Postdoctoral Researcher", "PhD", "MPhil", "BS-MS"]:
                    if deg_keyword in line_cleaned:
                        is_degree = True
                        break
                
                if is_degree:
                    if current_degree:
                        current_item["degrees"].append(current_degree)
                    
                    # Extract date
                    date_match = re.search(r'([A-Za-z]+ \d{4} [–-] [A-Za-z]+|[A-Za-z]+ \d{4})$', line_cleaned)
                    date_str = ""
                    degree_name = line_cleaned
                    if date_match:
                        date_str = date_match.group(1)
                        degree_name = line_cleaned[:date_match.start()].strip()
                        
                    current_degree = {
                        "degree": degree_name,
                        "date": date_str,
                        "advisor": "",
                        "dissertation": "",
                        "coursework": ""
                    }
                elif current_degree:
                    if line_cleaned.startswith("Advisor:") or line_cleaned.startswith("Advisors:"):
                        current_degree["advisor"] = line_cleaned.replace("Advisors:", "").replace("Advisor:", "").strip()
                    elif line_cleaned.startswith("Dissertation:"):
                        current_degree["dissertation"] = line_cleaned.replace("Dissertation:", "").strip()
                    elif line_cleaned.startswith("Coursework:"):
                        current_degree["coursework"] = line_cleaned.replace("Coursework:", "").strip()
                    else:
                        # Append to coursework or dissertation or degree
                        if current_degree["coursework"]:
                            current_degree["coursework"] += " " + line_cleaned
                        elif current_degree["dissertation"]:
                            current_degree["dissertation"] += " " + line_cleaned
                        elif current_degree["advisor"]:
                            current_degree["advisor"] += " " + line_cleaned
                        else:
                            current_degree["degree"] += " " + line_cleaned
                            
        if current_item:
            if current_degree:
                current_item["degrees"].append(current_degree)
            academic_items.append(current_item)
            
    cv_data["academic"] = academic_items

    # 2. Parse Specialized Training
    specialized_items = []
    if "specialized" in section_blocks:
        bullet_texts = parse_bullet_items(section_blocks["specialized"])
        for entry in bullet_texts:
            location = ""
            inst_name = entry
            loc_match = re.search(r'(Woods Hole, MA|Virtual)', entry)
            if loc_match:
                location = loc_match.group(1)
                inst_name = entry[:loc_match.start()].strip()
                rest = entry[loc_match.end():].strip()
            else:
                rest = entry
            
            date_match = re.search(r'(\d{4})$', rest)
            date_str = ""
            course_str = rest
            if date_match:
                date_str = date_match.group(1)
                course_str = rest[:date_match.start()].strip()
                
            specialized_items.append({
                "institution": inst_name,
                "location": location,
                "course": course_str,
                "date": date_str
            })
    cv_data["specialized_training"] = specialized_items

    # 3. Parse Publications
    publications = []
    if "publications" in section_blocks:
        bullet_texts = parse_bullet_items(section_blocks["publications"])
        for entry in bullet_texts:
            # Match Year/Status with or without inner whitespace
            year_match = re.search(r'\(\s*(20\d{2}|in prep|in press|prep)\s*\)', entry, re.IGNORECASE)
            if year_match:
                year = year_match.group(1).strip()
                authors = entry[:year_match.start()].strip().rstrip(",")
                rest = entry[year_match.end():].strip().rstrip(".")
                
                # Check for Journal
                journal = ""
                title = rest
                if "Nature Communications" in rest:
                    journal = "Nature Communications"
                    title = rest.replace("Nature Communications", "").strip().rstrip(". ,")
                elif "bioRxiv" in rest:
                    journal = "bioRxiv"
                    title = rest.replace("bioRxiv", "").strip().rstrip(". ,")
                elif "More Than a Squeak" in rest:
                    journal = "In Preparation"
                    title = rest
                
                url = ""
                if "Nature Communications" in journal:
                    url = "https://www.nature.com/articles/s41467-025-57882-8"
                elif "bioRxiv" in journal:
                    url = "https://www.biorxiv.org/content/10.64898/2026.06.05.730488v1"

                publications.append({
                    "authors": authors.strip(),
                    "year": year,
                    "title": title.strip().lstrip(". ,"),
                    "journal": journal,
                    "url": url
                })
            else:
                publications.append({
                    "authors": "Dake M.",
                    "year": "In Prep",
                    "title": entry,
                    "journal": "In Preparation",
                    "url": ""
                })
    cv_data["publications"] = publications

    # 4. Parse Posters & Talks
    posters_talks = []
    if "posters" in section_blocks:
        bullet_texts = parse_bullet_items(section_blocks["posters"])
        for entry in bullet_texts:
            parts = entry.split(";")
            if len(parts) >= 2:
                left_part = parts[0].strip()
                right_part = ";".join(parts[1:]).strip()
                
                # Sift authors from title
                authors, title = split_poster_authors_title(left_part)
                
                # Split venue and date
                date_match = re.search(r'([A-Za-z]+ \d{4}|\d{4})$', right_part)
                date_str = ""
                venue_str = right_part
                if date_match:
                    date_str = date_match.group(1)
                    venue_str = right_part[:date_match.start()].strip().rstrip(",")
                
                url = ""
                award = ""
                if "SfN" in venue_str and "2025" in date_str:
                    url = "docs/Dake_SfN2025_poster.pdf"
                    award = "SfN Trainee Professional Development Award (TPDA)"
                elif "CCN" in venue_str and "2025" in date_str:
                    url = "docs/CCN2025Poster_MrugankDake.pdf"
                    award = "NYU Dean's Conference Fund"
                elif "SfN" in venue_str and "2023" in date_str:
                    url = "docs/Dake_SfN2023_poster.pdf"
                elif "Li-Koff" in title:
                    url = "https://2020.igem.org/Team:MRIIRS_FARIDABAD/Poster"
                    award = "DBT India iBEC Award 2020"
                elif "CoCa coli" in title:
                    url = "docs/igem_poster.pdf"
                    award = "DBT India iBEC Award 2019"
                elif "two cortices" in title:
                    award = "NYU Dean's Award"
                
                posters_talks.append({
                    "authors": authors,
                    "title": title,
                    "venue": venue_str,
                    "date": date_str,
                    "url": url,
                    "award": award
                })
    cv_data["posters_talks"] = posters_talks

    # 5. Parse Pre-doctoral Research Experience
    predoc_items = []
    if "predoc" in section_blocks:
        bullet_texts = parse_bullet_items(section_blocks["predoc"])
        for entry in bullet_texts:
            # Separating advisor info
            advisor_str = ""
            title_part = entry
            adv_match = re.search(r'(Advisor:|Advisors:)(.*)$', entry, re.IGNORECASE)
            if adv_match:
                advisor_str = adv_match.group(2).strip()
                title_part = entry[:adv_match.start()].strip()
            
            # Split title and date
            date_match = re.search(r'([A-Za-z]+ \d{4} [–-] [A-Za-z]+ \d{4}|[A-Za-z]+ [–-] [A-Za-z]+ \d{4})$', title_part)
            date_str = ""
            title_str = title_part
            if date_match:
                date_str = date_match.group(1)
                title_str = title_part[:date_match.start()].strip()
                
            predoc_items.append({
                "title": title_str,
                "date": date_str,
                "advisor": advisor_str
            })
    cv_data["pre_doctoral"] = predoc_items

    # 6. Parse Professional Experience
    prof_items = []
    if "professional" in section_blocks:
        lines = [l.strip() for l in section_blocks["professional"].split("\n") if l.strip()]
        current_item = None
        
        for line in lines:
            line_cleaned = clean_text(line)
            if not line_cleaned:
                continue
                
            is_inst = False
            for keyword in ["Institute", "Labs", "University"]:
                if keyword in line_cleaned:
                    is_inst = True
                    break
                    
            if is_inst:
                if current_item:
                    prof_items.append(current_item)
                
                loc_match = re.search(r'(New York, NY|Burlingame, CA)$', line_cleaned)
                location = ""
                inst_name = line_cleaned
                if loc_match:
                    location = loc_match.group(1)
                    inst_name = line_cleaned[:loc_match.start()].strip()
                    
                current_item = {
                    "institution": inst_name,
                    "location": location,
                    "roles": []
                }
            elif current_item:
                if line_cleaned.startswith("Teaching Assistant:"):
                    class_text = line_cleaned.replace("Teaching Assistant:", "").strip()
                    sem_match = re.search(r'(Fall \d{4}|Spring \d{4})$', class_text)
                    sem_str = ""
                    class_name = class_text
                    if sem_match:
                        sem_str = sem_match.group(1)
                        class_name = class_text[:sem_match.start()].strip()
                        
                    ta_role = None
                    for r in current_item["roles"]:
                        if r["role"] == "Teaching Assistant":
                            ta_role = r
                            break
                    if not ta_role:
                        ta_role = {
                            "role": "Teaching Assistant",
                            "date": "2023 - 2025",
                            "ta_classes": []
                        }
                        current_item["roles"].append(ta_role)
                    ta_role["ta_classes"].append({
                        "class": class_name,
                        "semester": sem_str
                    })
                else:
                    date_match = re.search(r'([A-Za-z]+ \d{4} [–-] [A-Za-z]+|[A-Za-z]+ – [A-Za-z]+ \d{4})$', line_cleaned)
                    date_str = ""
                    role_str = line_cleaned
                    if date_match:
                        date_str = date_match.group(1)
                        role_str = line_cleaned[:date_match.start()].strip()
                    
                    current_item["roles"].append({
                        "role": role_str,
                        "date": date_str
                    })
        if current_item:
            prof_items.append(current_item)
    cv_data["professional_experience"] = prof_items

    # 7. Parse Professional Service
    service_items = []
    if "service" in section_blocks:
        lines = [l.strip() for l in section_blocks["service"].split("\n") if l.strip()]
        current_item = None
        for line in lines:
            line_cleaned = clean_text(line)
            if not line_cleaned:
                continue
                
            if ":" in line_cleaned:
                if current_item:
                    service_items.append(current_item)
                parts = line_cleaned.split(":", 1)
                role = parts[0].strip()
                details = parts[1].strip()
                
                year_match = re.search(r'(May – Nov \d{4}|\d{4})$', details)
                year_str = ""
                details_str = details
                if year_match:
                    year_str = year_match.group(1)
                    details_str = details[:year_match.start()].strip()
                    
                current_item = {
                    "role": role,
                    "details": details_str,
                    "year": year_str
                }
            elif current_item:
                if current_item["details"].endswith("-"):
                    current_item["details"] = current_item["details"][:-1] + line_cleaned
                else:
                    current_item["details"] += " " + line_cleaned
        if current_item:
            service_items.append(current_item)
    cv_data["service"] = service_items

    # 8. Parse Awards
    awards_items = []
    if "awards" in section_blocks:
        lines = [l.strip() for l in section_blocks["awards"].split("\n") if l.strip()]
        for line in lines:
            line_cleaned = clean_text(line)
            if not line_cleaned:
                continue
            date_match = re.search(r'(\d{4} [–-] \d{4}|\d{4})$', line_cleaned)
            date_str = ""
            award_title = line_cleaned
            if date_match:
                date_str = date_match.group(1)
                award_title = line_cleaned[:date_match.start()].strip()
            awards_items.append({
                "title": award_title,
                "date": date_str
            })
    cv_data["awards"] = awards_items

    # 9. Parse Skills (Using exact Page 2 column groupings)
    # Filter elements on page 2 (index 1) with Y < 130
    skills_lines_elements = [el for el in skills_elements if el["y"] < 130]
    
    # Group elements into lines by Y coordinate (tolerance of 5 points)
    lines = []
    for el in skills_lines_elements:
        found = False
        for line in lines:
            if abs(line["y"] - el["y"]) <= 5:
                line["elements"].append(el)
                found = True
                break
        if not found:
            lines.append({"y": el["y"], "elements": [el]})
            
    # Sort lines by Y descending
    lines.sort(key=lambda l: -l["y"])
    
    left_col_text = []
    right_col_text = []
    for line in lines:
        left_elements = [el for el in line["elements"] if el["x"] < 300]
        right_elements = [el for el in line["elements"] if el["x"] >= 300]
        
        left_elements.sort(key=lambda el: el["x"])
        right_elements.sort(key=lambda el: el["x"])
        
        left_text = " ".join([el["text"] for el in left_elements]).strip()
        right_text = " ".join([el["text"] for el in right_elements]).strip()
        
        if left_text:
            left_col_text.append((left_text, line["y"]))
        if right_text:
            right_col_text.append((right_text, line["y"]))

    def group_column_skills(col_parts):
        categories = {}
        current_cat = None
        for text, y in col_parts:
            text_clean = text.strip()
            if not text_clean or text_clean == "/cogs":
                continue
            
            # Identify category headers
            if text_clean in ["Programming", "Neuroscience Tools", "Data Science & ML", "Other Tools & Languages"]:
                current_cat = text_clean
                categories[current_cat] = []
            elif current_cat:
                categories[current_cat].append(text_clean)
                
        skills_dict = {}
        for cat, parts in categories.items():
            joined = " ".join(parts)
            # Normalize whitespace first
            joined = re.sub(r'\s+', ' ', joined)
            joined = joined.replace("L A TEX", "LaTeX")
            joined = joined.replace("L ATEX", "LaTeX")
            joined = joined.replace("LATEX", "LaTeX")
            joined = joined.replace("Adobe Photoshop English (Fluent)", "Adobe Photoshop, English (Fluent)")
            skills_dict[cat] = [s.strip() for s in joined.split(",") if s.strip()]
        return skills_dict

    skills = {}
    skills.update(group_column_skills(left_col_text))
    skills.update(group_column_skills(right_col_text))
    cv_data["skills"] = skills

    # Write out cv_data.js
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write("// Auto-generated from MrugankDakeCV.pdf by update_cv.py\n")
        f.write("const CV_DATA = ")
        json.dump(cv_data, f, indent=2, ensure_ascii=False)
        f.write(";\n")

    print(f"Successfully generated interactive CV data at {OUTPUT_PATH}")

if __name__ == "__main__":
    main()
