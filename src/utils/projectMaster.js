// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Project Master v1.0
// Shared project/cost-centre list — persisted to localStorage.
// Used by Invoices (Project Reference) and, going forward, by the Project
// P&L report in Accounting (not yet built — this master list is the
// prerequisite for that report to mean anything).
//
// SOURCE: Project_List_htm__1_.html (live SAGE export, 13 active projects)
// SAGE's "Project Description" and "Project Name" columns frequently repeat
// the same value as the Code, or are blank — captured faithfully as-is
// rather than inventing fuller descriptions.
// ══════════════════════════════════════════════════════════════════════════════
import { generateId } from './helpers';

const PROJECT_KEY = 'bc_projects';

const SEED_PROJECTS = [
  { id:'p001', code:'ALETO',              name:'Aleto',                          description:'Aleto',                                   client:'',     status:'Active', createdAt:'2026-05-29T00:00:00Z' },
  { id:'p002', code:'ASSA NORTH',         name:'Assa North',                     description:'Assa North',                              client:'',     status:'Active', createdAt:'2026-05-29T00:00:00Z' },
  { id:'p003', code:'BOWER',              name:'SNG-Bower',                      description:'SNG-Bower',                               client:'',     status:'Active', createdAt:'2026-05-29T00:00:00Z' },
  { id:'p004', code:'FLOPENG LOGISTICS',  name:'Geoplex Logistics',              description:'Geoplex Logistics',                       client:'GEOPLEX DRILLTEQ LTD', status:'Active', createdAt:'2026-05-29T00:00:00Z' },
  { id:'p005', code:'GBARAM',             name:'Gbaram',                         description:'Job in progress — scope of service to be confirmed', client:'',     status:'Active', createdAt:'2026-05-29T00:00:00Z' },
  { id:'p006', code:'NLNG EXP',           name:'NLNG Procurement',               description:'NLNG Procurement',                        client:'NLNG NGN', status:'Active', createdAt:'2026-05-29T00:00:00Z' },
  { id:'p007', code:'NLNG HRSS',          name:'NLNG HRSS',                      description:'NLNG HRS',                                client:'NLNG NGN', status:'Active', createdAt:'2026-05-29T00:00:00Z' },
  { id:'p008', code:'NON-PROJECT',        name:'Non-Project',                    description:'Non-Project',                             client:'',     status:'Active', createdAt:'2026-05-29T00:00:00Z' },
  { id:'p009', code:'SAIPEM',             name:'Saipem',                         description:'Procurement services for Saipem',         client:'SAIPEM USD', status:'Active', createdAt:'2026-05-29T00:00:00Z' },
  { id:'p010', code:'SNG BOFO',           name:'SNG Bofo',                       description:'SNG Bofo',                                client:'',     status:'Active', createdAt:'2026-05-29T00:00:00Z' },
  { id:'p011', code:'SNG PROJECT',        name:'SNG Project',                    description:'SNG Project',                             client:'',     status:'Active', createdAt:'2026-05-29T00:00:00Z' },
  { id:'p012', code:'SPDC',               name:'Renaissance',                    description:'Renaissance Africa Energy Company Ltd',  client:'SPDC', status:'Active', createdAt:'2026-05-29T00:00:00Z' },
  { id:'p013', code:'SPDC CABLE PROJECT', name:'SPDC Cable Project',             description:'SPDC Cable Project',                      client:'SPDC', status:'Active', createdAt:'2026-05-29T00:00:00Z' },
];

export function getProjects() {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (!raw) {
      localStorage.setItem(PROJECT_KEY, JSON.stringify(SEED_PROJECTS));
      return SEED_PROJECTS;
    }
    return JSON.parse(raw);
  } catch {
    return SEED_PROJECTS;
  }
}

export function saveProjects(projects) {
  try { localStorage.setItem(PROJECT_KEY, JSON.stringify(projects)); } catch {}
  try { window.dispatchEvent(new CustomEvent('slot:masterDataChanged', { detail: { mod: 'projects', data: projects } })); } catch {}
}

export function addProject(project) {
  const projects = getProjects();
  const rec = { ...project, id: generateId(), createdAt: new Date().toISOString() };
  const updated = [...projects, rec];
  saveProjects(updated);
  return updated;
}

export function updateProject(id, changes) {
  const projects = getProjects().map(p => p.id === id ? { ...p, ...changes } : p);
  saveProjects(projects);
  return projects;
}

export function deleteProject(id) {
  const projects = getProjects().filter(p => p.id !== id);
  saveProjects(projects);
  return projects;
}

/** Returns active project codes for dropdown use */
export function getProjectCodes() {
  return getProjects().filter(p => p.status === 'Active').map(p => p.code).sort();
}

/** Look up a project by its SAGE code */
export function getProjectByCode(code) {
  return getProjects().find(p => p.code === code) || null;
}
