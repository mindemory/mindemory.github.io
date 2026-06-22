// Interactive Dynamic CV Script

document.addEventListener('DOMContentLoaded', function () {
    // 1. Render all sections from CV_DATA
    renderCV();
    
    // 2. Initialize interactive features
    initTheme();
    initSmoothScroll();
    initActiveNavHighlight();
});

// 1. DYNAMIC RENDERING ENGINE
function renderCV() {
    if (typeof CV_DATA === 'undefined') {
        console.error("Error: CV_DATA is not loaded.");
        return;
    }
    
    renderAcademicHistory();
    renderSpecializedTraining();
    renderPublications();
    renderPostersTalks();
    renderPreDoctoral();
    renderProfessionalExperience();
    renderService();
    renderAwards();
    renderSkills();
    
}

function renderAcademicHistory() {
    const container = document.getElementById('academicTimeline');
    if (!container || !CV_DATA.academic) return;
    
    container.innerHTML = CV_DATA.academic.map(inst => {
        const degreesHtml = inst.degrees.map((deg, idx) => {
            let detailsHtml = '';
            if (deg.dissertation) {
                detailsHtml += `<p class="details"><strong>Dissertation:</strong> ${deg.dissertation}</p>`;
            }
            if (deg.coursework) {
                detailsHtml += `<p class="coursework"><strong>Coursework:</strong> ${deg.coursework}</p>`;
            }
            
            const isSubRole = idx > 0;
            const roleClass = isSubRole ? 'role sub-role' : 'role';
            
            return `
                <div class="timeline-subheader">
                    <h4 class="${roleClass}">${deg.degree}</h4>
                    <span class="timeline-date">${deg.date}</span>
                </div>
                ${deg.advisor ? `<p class="advisor"><strong>Advisor:</strong> ${deg.advisor}</p>` : ''}
                ${detailsHtml}
            `;
        }).join('');
        
        return `
            <div class="timeline-item">
                <div class="timeline-header">
                    <h3>${inst.institution}</h3>
                    <span class="location">${inst.location}</span>
                </div>
                <div class="timeline-body">
                    ${degreesHtml}
                </div>
            </div>
        `;
    }).join('');
}

function renderSpecializedTraining() {
    const container = document.getElementById('specializedTrainingList');
    if (!container || !CV_DATA.specialized_training) return;
    
    container.innerHTML = CV_DATA.specialized_training.map(item => {
        return `
            <div class="exp-item">
                <div class="timeline-header">
                    <h3>${item.institution}</h3>
                    <span class="location">${item.location}</span>
                </div>
                <div class="timeline-subheader">
                    <span class="role">${item.course}</span>
                    <span class="timeline-date">${item.date}</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderPublications() {
    const container = document.getElementById('publicationList');
    if (!container || !CV_DATA.publications) return;
    
    container.innerHTML = CV_DATA.publications.map(pub => {
        const badgeClass = pub.journal === 'Nature Communications' ? 'badge-journal' :
                           pub.journal === 'bioRxiv' ? 'badge-preprint' : 'badge-prep';
        const badgeText = pub.journal || 'In Preparation';
        
        let linksHtml = '';
        if (pub.url) {
            const btnText = pub.journal === 'bioRxiv' ? 'Preprint' : 'Article';
            linksHtml += `<a href="${pub.url}" target="_blank" class="pub-link-btn"><i class="fas fa-external-link-alt"></i> ${btnText}</a>`;
        }
        if (pub.journal === 'Nature Communications') {
            linksHtml += `<a href="https://www.futurity.org/working-memory-3283812/" target="_blank" class="pub-link-btn press-btn"><i class="fas fa-newspaper"></i> Press Coverage</a>`;
        }
        
        return `
            <div class="pub-item">
                <div class="pub-meta">
                    <span class="pub-year">${pub.year}</span>
                    <span class="badge ${badgeClass}">${badgeText}</span>
                </div>
                <p class="pub-citation">
                    <strong>${pub.authors}</strong> (${pub.year}). ${pub.title}. <em>${pub.journal}</em>.
                </p>
                ${linksHtml ? `<div class="pub-links no-print">${linksHtml}</div>` : ''}
            </div>
        `;
    }).join('');
}

// Custom split to help isolate authors and title for event citation formatting
function splitPosterAuthorsTitle(text) {
    const starters = [
        "Working memory synchronizes",
        "Do perturbations to visual",
        "Perturbing human V1",
        "Li-Koff:",
        "CoCa coli:",
        "A tale of two cortices"
    ]
    for (const starter of starters) {
        const idx = text.indexOf(starter);
        if (idx > -1) {
            const authors = text.substring(0, idx).trim().replace(/,\s*$/, "");
            const title = text.substring(idx).trim();
            return { authors, title };
        }
    }
    return { authors: "Dake M.", title: text };
}

function renderPostersTalks() {
    const container = document.getElementById('eventList');
    if (!container || !CV_DATA.posters_talks) return;
    
    container.innerHTML = CV_DATA.posters_talks.map(event => {
        const badgeClass = event.award ? 'badge-award' : 
                           (event.venue.includes('Symposium') || event.venue.includes('Award') ? 'badge-talk' : 'badge-poster');
        const badgeText = event.award ? event.award : 
                           (event.venue.includes('Symposium') || event.venue.includes('Award') ? 'Talk' : 'Poster');
        
        let linksHtml = '';
        if (event.url) {
            linksHtml += `<a href="${event.url}" target="_blank" class="pub-link-btn"><i class="fas fa-file-pdf"></i> View Poster</a>`;
        }
        
        return `
            <div class="event-item">
                <div class="event-meta">
                    <span class="event-date">${event.date}</span>
                    <span class="badge ${badgeClass}">${badgeText}</span>
                </div>
                <h4>${event.title}</h4>
                <p class="event-venue"><em>${event.venue}</em></p>
                <p class="event-authors">${event.authors}</p>
                ${linksHtml ? `<div class="pub-links no-print">${linksHtml}</div>` : ''}
            </div>
        `;
    }).join('');
}

function renderPreDoctoral() {
    const container = document.getElementById('preDocList');
    if (!container || !CV_DATA.pre_doctoral) return;
    
    container.innerHTML = CV_DATA.pre_doctoral.map(item => {
        return `
            <div class="exp-item">
                <div class="timeline-header">
                    <h3>${item.title}</h3>
                    <span class="timeline-date">${item.date}</span>
                </div>
                <p class="advisor"><strong>Advisor:</strong> ${item.advisor}</p>
            </div>
        `;
    }).join('');
}

function renderProfessionalExperience() {
    const container = document.getElementById('professionalTimeline');
    if (!container || !CV_DATA.professional_experience) return;
    
    container.innerHTML = CV_DATA.professional_experience.map(inst => {
        const rolesHtml = inst.roles.map(role => {
            let taClassesHtml = '';
            if (role.ta_classes) {
                taClassesHtml = `
                    <ul class="ta-list">
                        ${role.ta_classes.map(cls => `
                            <li><strong>${cls.class}</strong> <span class="sem">${cls.semester}</span></li>
                        `).join('')}
                    </ul>
                `;
            }
            
            return `
                <div class="timeline-subheader">
                    <h4 class="role">${role.role}</h4>
                    <span class="timeline-date">${role.date || ''}</span>
                </div>
                ${taClassesHtml}
            `;
        }).join('');
        
        return `
            <div class="timeline-item">
                <div class="timeline-header">
                    <h3>${inst.institution}</h3>
                    <span class="location">${inst.location || ''}</span>
                </div>
                <div class="timeline-body">
                    ${rolesHtml}
                </div>
            </div>
        `;
    }).join('');
}

function renderService() {
    const container = document.getElementById('serviceList');
    if (!container || !CV_DATA.service) return;
    
    container.innerHTML = CV_DATA.service.map(item => {
        return `
            <li>
                <strong>${item.role}:</strong> ${item.details}
                ${item.year ? `<span class="year">${item.year}</span>` : ''}
            </li>
        `;
    }).join('');
}

function renderAwards() {
    const container = document.getElementById('awardsList');
    if (!container || !CV_DATA.awards) return;
    
    container.innerHTML = CV_DATA.awards.map(award => {
        return `
            <li>
                <span class="award-date">${award.date}</span>
                <div class="award-info">
                    <strong>${award.title}</strong>
                </div>
            </li>
        `;
    }).join('');
}

function renderSkills() {
    const container = document.getElementById('skillsGrid');
    if (!container || !CV_DATA.skills) return;
    
    container.innerHTML = Object.entries(CV_DATA.skills).map(([category, list]) => {
        const tagsHtml = list.map(skill => `<span>${skill}</span>`).join('');
        return `
            <div class="skills-category-card">
                <h3>${category}</h3>
                <div class="skills-tags-display">
                    ${tagsHtml}
                </div>
            </div>
        `;
    }).join('');
}

// 2. THEME MANAGER
function initTheme() {
    const html = document.documentElement;
    const themeToggle = document.getElementById('themeToggleCv');

    // Sync with saved preference
    const currentTheme = localStorage.getItem('theme') || 'dark';
    html.setAttribute('data-theme', currentTheme);
    updateThemeIcon(currentTheme);

    themeToggle.addEventListener('click', () => {
        const theme = html.getAttribute('data-theme');
        const newTheme = theme === 'light' ? 'dark' : 'light';

        html.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);

        html.style.transition = 'all 0.3s ease';
        setTimeout(() => {
            html.style.transition = '';
        }, 300);
    });
}

function updateThemeIcon(theme) {
    const icon = document.querySelector('#themeToggleCv i');
    if (icon) {
        if (theme === 'dark') {
            icon.className = 'fas fa-sun';
        } else {
            icon.className = 'fas fa-moon';
        }
    }
}

// 3. SMOOTH SCROLLING
function initSmoothScroll() {
    const links = document.querySelectorAll('.cv-nav-link');
    links.forEach(link => {
        link.addEventListener('click', (e) => {
            const href = link.getAttribute('href');
            if (href && href.startsWith('#')) {
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    const offset = target.offsetTop - 90;
                    window.scrollTo({
                        top: offset,
                        behavior: 'smooth'
                    });
                }
            }
        });
    });
}

// 4. NAV HIGHLIGHT ON SCROLL
function initActiveNavHighlight() {
    const sections = document.querySelectorAll('.cv-section');
    const navLinks = document.querySelectorAll('.cv-nav-link');

    window.addEventListener('scroll', () => {
        let currentSectionId = '';
        const scrollPosition = window.pageYOffset + 120;

        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            if (scrollPosition >= sectionTop) {
                currentSectionId = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${currentSectionId}`) {
                link.classList.add('active');
            }
        });
    });
}


