// Public client config. The anon key is designed to be shipped in the browser.
// Leave both strings empty until a Supabase project exists: the app then stays
// local-first and does not call a server.
// Never put a service_role key in this file. It bypasses row level security.
(function (root) {
  'use strict';

  var file = {
    supabaseUrl: 'https://vjruyrawruirwrwqfeyy.supabase.co',
    // Publishable client key. It is safe in the browser. Never put a
    // service_role key here.
    supabaseAnonKey: 'sb_publishable_VwoY6M9dizu9sinDwHRkNA_Ar6S5OJ2',
    // Public half of the push key. Delivery stays off until the send-push
    // function is deployed with the private key.
    vapidPublicKey: 'BMpyOYWKiVip5rU3RUdQ8z_EsAooS1S_LaGYEwQaUtPjHMJTBjsfzRIySCYfD1vezqtn-_zROu4XV4xxyYx8B7w',
    pushEnabled: true
  };

  // A loopback override lets a local check point at a dev API without
  // committing keys. Production hosts ignore it.
  var host = '';
  try { host = root.location && root.location.hostname; } catch (err) { host = ''; }
  if (host === '127.0.0.1' || host === 'localhost') {
    try {
      var extra = JSON.parse(root.localStorage.getItem('summitlog_config_override') || 'null');
      if (extra && extra.supabaseUrl && extra.supabaseAnonKey) {
        file.supabaseUrl = String(extra.supabaseUrl);
        file.supabaseAnonKey = String(extra.supabaseAnonKey);
        if (extra.vapidPublicKey) file.vapidPublicKey = String(extra.vapidPublicKey);
        if (typeof extra.pushEnabled === 'boolean') file.pushEnabled = extra.pushEnabled;
      }
    } catch (err) {
      // A bad override must not break the page. The empty file config stands.
    }
  }

  root.SUMMIT_CONFIG = file;
})(typeof globalThis !== 'undefined' ? globalThis : this);
