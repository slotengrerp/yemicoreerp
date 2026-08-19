// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Two-Admin Wipe Approval Gate
//
// 2026-08-19: the Backup module's "Wipe All Data" button used to run on a
// single admin's say-so (one window.confirm + one window.prompt, all in the
// same click). It also only ever cleared localStorage and the legacy,
// no-longer-read `company_data` blob — it never touched the real per-record
// tables where live business data lives (see db.js / usePerRecordSync.js).
//
// This closes both gaps:
//   1. A wipe now genuinely clears the real per-record tables, scoped to
//      this company — see execute_company_wipe() in the wipe_requests
//      migration.
//   2. It requires two DIFFERENT active admins: one requests it, a second
//      one has to independently approve before anything is deleted. The
//      distinct-approver check and the actual delete both live in a
//      SECURITY DEFINER Postgres function, not in this client code — a
//      user calling the Supabase API directly, bypassing this UI entirely,
//      still can't self-approve or skip the second admin.
//
// All of the actual guarding (admin-only, distinct approver, 24h expiry,
// which tables get cleared) lives in the wipe_requests table's RLS/triggers
// and the execute_company_wipe()/cancel_wipe_request() functions. This file
// is a thin, honest client for that — it does not duplicate those checks,
// because a client-side copy of a security check is not a security check.
// ══════════════════════════════════════════════════════════════════════════════
import { supabase } from './client';

const COMPANY_ID = import.meta.env.VITE_COMPANY_DOC || 'slot-engineering-nigeria';

export async function getActiveWipeRequest() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('wipe_requests')
    .select('*')
    .eq('company_id', COMPANY_ID)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getWipeHistory(limit = 10) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('wipe_requests')
    .select('*')
    .eq('company_id', COMPANY_ID)
    .neq('status', 'pending')
    .order('requested_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// company_id/requested_by/requested_by_name/status/expires_at are all
// overwritten server-side by the stamp_wipe_request trigger regardless of
// what's sent here — only `reason` is actually taken from the client.
//
// requested_by/requested_by_name must be OMITTED here, not sent as ''. Both
// columns are typed (uuid / text NOT NULL) and Postgres validates literal
// values against the column type while parsing the INSERT, before any
// BEFORE INSERT trigger runs — so an empty-string placeholder for a uuid
// column fails immediately ("invalid input syntax for type uuid: \"\"")
// and never even reaches stamp_wipe_request() to be overwritten. Leaving
// the keys out entirely lets the trigger set them from a clean NULL.
export async function requestWipe(reason) {
  if (!supabase) throw new Error('Cloud not connected');
  const { data, error } = await supabase
    .from('wipe_requests')
    .insert({ reason: reason || null, company_id: COMPANY_ID })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Approving IS executing — reaching the second distinct admin's approval is
// what triggers the delete, inside the same guarded database call.
export async function approveAndExecuteWipe(requestId) {
  if (!supabase) throw new Error('Cloud not connected');
  const { data, error } = await supabase.rpc('execute_company_wipe', { request_id: requestId });
  if (error) throw error;
  return data;
}

export async function cancelWipeRequest(requestId) {
  if (!supabase) throw new Error('Cloud not connected');
  const { error } = await supabase.rpc('cancel_wipe_request', { request_id: requestId });
  if (error) throw error;
}

export function subscribeWipeRequests(onChange) {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`wipe_requests-${COMPANY_ID}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'wipe_requests', filter: `company_id=eq.${COMPANY_ID}` },
      onChange)
    .subscribe();
  return () => { try { supabase.removeChannel(channel); } catch {} };
}
