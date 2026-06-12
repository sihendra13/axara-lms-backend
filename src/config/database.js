const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Regular client — subject to RLS (for authenticated user operations)
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Service client — bypasses RLS (for auth operations and admin tasks only)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);

module.exports = { supabase, supabaseAdmin };
