// Verifies the contract App.jsx's listener depends on: saving client/
// project/vendor master data must fire a 'slot:masterDataChanged' event
// with the module name and the new list, or the App.jsx bridge has nothing
// to listen for and this data silently goes back to being local-only.
import { describe, it, expect, beforeEach } from 'vitest';
import { addClient, getClients }   from '../clientMaster';
import { addProject, getProjects } from '../projectMaster';
import { addVendor, getVendors }   from '../vendorMaster';

function captureNextEvent() {
  return new Promise(resolve => {
    window.addEventListener('slot:masterDataChanged', e => resolve(e.detail), { once: true });
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe('master data → central store event bridge', () => {
  it('fires the sync event with the updated list when a client is added', async () => {
    const captured = captureNextEvent();
    const before = getClients().length;
    addClient({ code: 'TESTCO', name: 'Test Company Ltd', currency: 'NGN', status: 'Active' });
    const detail = await captured;

    expect(detail.mod).toBe('clients');
    expect(detail.data.length).toBe(before + 1);
    expect(detail.data.some(c => c.code === 'TESTCO')).toBe(true);
  });

  it('fires the sync event when a project is added', async () => {
    const captured = captureNextEvent();
    const before = getProjects().length;
    addProject({ code: 'TESTPRJ', name: 'Test Project', status: 'Active' });
    const detail = await captured;

    expect(detail.mod).toBe('projects');
    expect(detail.data.length).toBe(before + 1);
  });

  it('fires the sync event when a vendor is added', async () => {
    const captured = captureNextEvent();
    const before = getVendors().length;
    addVendor({ code: 'TESTVEND', name: 'Test Vendor Ltd', status: 'Active' });
    const detail = await captured;

    expect(detail.mod).toBe('vendors');
    expect(detail.data.length).toBe(before + 1);
  });
});
