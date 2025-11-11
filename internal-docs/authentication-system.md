# Authentication System

## Table of Contents
1. [Username + Password Implementation](#username--password-implementation)
2. [Account Migration System](#account-migration-system)
3. [Addon Reconfiguration System](#addon-reconfiguration-system)
4. [Implementation Checklist](#implementation-checklist)

## Complete Migration Flow Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ OLD USER (Password-only)                                            │
│ password_hash = SHA256(password)                                    │
│ Data in: translation_queue table                                   │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 1: Login with password-only                                    │
│ System detects: isOldUser = true                                    │
│ Dashboard shows: Migration Alert (Nov 17, 2025 deadline)            │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 2: User clicks "Upgrade Now" or "Learn More"                   │
│ Fills form: username + existing password                            │
│ Submits: POST /api/migrate-account                                  │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 3: System creates new user account                             │
│ INSERT INTO users (username, password_hash, password_bcrypt,        │
│                    needs_addon_reconfiguration)                     │
│ VALUES (?, SHA256(username+password), bcrypt(password), TRUE)       │
│                                                                      │
│ UPDATE translation_queue SET password_hash = new_hash               │
│ WHERE password_hash = old_hash                                      │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 4: User logged out automatically                               │
│ Re-login with: username + password                                  │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 5: Dashboard shows addon reconfiguration alert                 │
│ System detected: needs_addon_reconfiguration = TRUE                 │
│ Alert: "You must reinstall your Stremio addon"                      │
│ Button: "🔧 Reinstall Addon" → /configure                           │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼ (Old addon config STOPS WORKING here)
┌─────────────────────────────────────────────────────────────────────┐
│ WHY OLD ADDON FAILS:                                                │
│ Old config sends: password only                                     │
│ System generates: SHA256(password) ❌                               │
│ Database expects: SHA256(username+password) ✓                       │
│ Result: Hashes don't match → No translations found                  │
└─────────────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 6: User visits /configure                                      │
│ Fills form: username + password (new credentials)                   │
│ Clicks: "Install Addon" / "Copy Link" / "Open in Web"               │
│ Triggers: POST /api/create-user                                     │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 7: System detects existing user and clears flag                │
│ UPDATE users SET needs_addon_reconfiguration = FALSE                │
│ WHERE username = ? AND needs_addon_reconfiguration = TRUE           │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 8: Complete! Addon works with new credentials                  │
│ New config sends: username + password                               │
│ System generates: SHA256(username+password) ✓                       │
│ Database has: SHA256(username+password) ✓                           │
│ Result: Hashes match → Translations work! ✅                        │
│                                                                      │
│ Dashboard: No alerts shown                                          │
│ needs_addon_reconfiguration = FALSE                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Username + Password Implementation

### Database Schema

**users table:**
- `username` (VARCHAR/TEXT, UNIQUE, NOT NULL)
- `password_hash` (VARCHAR/TEXT, NOT NULL) - SHA256(username+password)
- `password_bcrypt` (VARCHAR/TEXT, NULL) - bcrypt(password)
- `needs_addon_reconfiguration` (BOOLEAN/INTEGER, DEFAULT FALSE) - Flag for addon reinstall requirement
- `created_at` (TIMESTAMP/DATETIME)

### Authentication Flow

**New Users (username+password):**
1. Configure addon with username + password (both required)
2. System generates: SHA256(username+password)
3. Creates user in `users` table
4. Login requires username + password
5. Validates against `users.password_hash`

**Old Users (password-only):**
1. Login without username
2. System generates: SHA256(password)
3. Validates against `translation_queue.password_hash`

### API Endpoints

**POST /api/create-user**
- Creates user before configure actions
- Saves `password_hash` (SHA256) and `password_bcrypt` (bcrypt)
- Called by: Install Addon, Copy Link, Open in Web

**POST /admin/auth**
- If username provided: checks `users` table with SHA256(username+password)
- If username empty: checks `translation_queue` with SHA256(password)
- Sets `req.session.userPasswordHash` for both cases

### Files Modified

- `configure.html` - Username required
- `views/login.html` - Username optional with hint
- `index.js` - Create user API + auth logic
- `database/migrations/009_create_users_table.js` - Users table
- `database/migrations/010_add_password_bcrypt_column.js` - Bcrypt column
- `database/adapters/SQLiteAdapter.js` - Auto-create users table
- `database/sql/mysql-schema.sql` - Users table schema

---

## Account Migration System

### Overview

The account migration system helps old users (password-only) upgrade to the new username+password authentication system. This ensures a smooth transition while maintaining backward compatibility.

### Migration Deadline

**Fixed Date:** November 17, 2025
**Start Date:** November 10, 2025 (7-day migration period)

### User Detection

**detectUserType() function:**
- Checks if logged-in user exists in `users` table (new user)
- Falls back to checking `translation_queue` for password_hash (old user)
- Returns: `{ isOldUser: boolean, hasUsername: boolean, username: string|null }`

**attachUserInfo middleware:**
- Attaches user type information to `req.userInfo`
- Used in dashboard route to pass user info to views

### Migration UI Components

**1. Alert Banner (dashboard.ejs)**
- Shows at top of dashboard for old users
- Features:
  - Warning icon and styling
  - Real-time countdown timer (updates every minute)
  - "Upgrade Now" button (opens modal)
  - "Learn More" link (goes to migration page)
  - Dismissible (reappears after 24 hours)
  - localStorage tracking for dismissal

**2. Migration Modal (dashboard.ejs)**
- Quick in-page account upgrade
- Form fields: username + password
- Shows warning about logout after migration
- API call to POST /api/migrate-account
- Success: redirects to logout
- Error handling with user feedback

**3. Migration Page (views/migrate-account.html)**
- Standalone page with detailed explanation
- Sections:
  - What's Happening - Overview of the change
  - Why This Change - Security benefits
  - What Happens During Migration - Step-by-step process
  - Your Data is Safe - Data preservation guarantee
  - Migration form with username + password fields
  - Need Help section
- Beautiful gradient design matching dashboard
- Real-time countdown badge

### API Endpoints

**GET /api/user-info**
- Returns user type information
- Used for client-side user detection
- Requires authentication

**POST /api/migrate-account**
- Body: `{ username, password }`
- Process:
  1. Validates old user status
  2. Generates new password_hash: SHA256(username+password)
  3. Generates password_bcrypt: bcrypt(password, 10)
  4. Checks username uniqueness
  5. Inserts into users table
  6. Updates all translation_queue records with new password_hash
  7. Updates session with new password_hash
- Returns: `{ success: true, message }`
- Errors: 400 (validation), 409 (username exists), 500 (server error)

**GET /admin/migrate**
- Serves migration page
- Requires authentication
- Redirects to dashboard if user already migrated
- Shows [migrate-account.html](migrate-account.html)

### Migration Process

1. **User logs in** with old password-only credentials
2. **Alert appears** on dashboard with countdown
3. **User clicks** "Upgrade Now" or "Learn More"
4. **User provides** username + existing password
5. **System creates** new user in users table with `needs_addon_reconfiguration=true`
6. **System transfers** all translations from old to new password_hash
7. **User logged out** automatically
8. **User re-logs in** with username + password
9. **Addon reconfiguration alert** appears on dashboard
10. **User reinstalls addon** with new credentials at /configure
11. **System marks** `needs_addon_reconfiguration=false` when addon is reconfigured

### Data Transfer

```sql
UPDATE translation_queue
SET password_hash = ?
WHERE password_hash = ?
```

All records with old password_hash are updated to new password_hash, ensuring complete data transfer.

---

## Addon Reconfiguration System

### Overview

After account migration, users must reinstall their Stremio addon with new credentials because the old `password_hash` (SHA256 of password only) no longer matches the new `password_hash` (SHA256 of username+password). The `needs_addon_reconfiguration` flag tracks this requirement.

### Why Reconfiguration is Required

**The Problem:**
- Old addon config sends: `config.password` only
- System generates: `SHA256(password)` from old config
- Database now has: `SHA256(username + password)` after migration
- ❌ Hashes don't match → translations not found

**The Solution:**
- User must reconfigure addon with username + password
- New addon config sends: `config.username` + `config.password`
- System generates: `SHA256(username + password)`
- ✅ Hashes match → translations work

### Database Column

**Column:** `needs_addon_reconfiguration`
- **Type:** BOOLEAN (MySQL) / INTEGER (SQLite)
- **Default:** FALSE (0)
- **Set to TRUE when:** User completes account migration
- **Set to FALSE when:** User reconfigures addon (calls /api/create-user with existing username)

### Reconfiguration Flow

#### 1. After Migration (needs_addon_reconfiguration = TRUE)

**POST /api/migrate-account** sets flag:
```javascript
await adapter.query(
  'INSERT INTO users (username, password_hash, password_bcrypt, needs_addon_reconfiguration) VALUES (?, ?, ?, ?)',
  [username, newPasswordHash, passwordBcrypt, true]
);
```

**detectUserType()** returns flag:
```javascript
{
  isOldUser: false,
  hasUsername: true,
  username: "john_doe",
  needsAddonReconfiguration: true  // ← Flag is true
}
```

**Dashboard shows alert:**
```html
<div class="migration-alert" id="reconfigAlert">
  <h3>Addon Reconfiguration Required</h3>
  <p>You must reinstall your Stremio addon with new credentials</p>
  <a href="/configure">🔧 Reinstall Addon</a>
</div>
```

#### 2. User Reinstalls Addon (needs_addon_reconfiguration = FALSE)

**User visits /configure:**
- Fills form with username + password
- Clicks "Install Addon", "Copy Link", or "Open in Web"
- Triggers **POST /api/create-user**

**POST /api/create-user** clears flag:
```javascript
const existingUser = await adapter.query(
  'SELECT id, needs_addon_reconfiguration FROM users WHERE username = ?',
  [username]
);

if (existingUser.length > 0 && existingUser[0].needs_addon_reconfiguration) {
  await adapter.query(
    'UPDATE users SET needs_addon_reconfiguration = ? WHERE username = ?',
    [false, username]
  );
  console.log(`[CREATE-USER] User ${username} reconfigured addon, marking needs_addon_reconfiguration=false`);
}
```

**Next dashboard visit:**
- `needsAddonReconfiguration: false`
- Alert no longer appears
- User can use addon normally

### UI Components

**1. Dashboard Alert (dashboard.ejs)**
```ejs
<% if (userInfo && userInfo.needsAddonReconfiguration) { %>
<div class="migration-alert" id="reconfigAlert" style="background: #fff3cd; border-left-color: #ffc107;">
  <div class="migration-alert-icon">🔌</div>
  <div class="migration-alert-content">
    <h3>Addon Reconfiguration Required</h3>
    <p>You've successfully migrated your account! Now you need to <strong>reinstall your Stremio addon</strong> with your new username and password to complete the process.</p>
    <div class="migration-alert-actions">
      <a href="/configure" class="btn btn-primary btn-sm">🔧 Reinstall Addon</a>
    </div>
  </div>
</div>
<% } %>
```

**2. Migration Page Warning (migrate-account.html)**
- Warning box highlighting addon reconfiguration requirement
- Direct link to /configure page
- Clear explanation that old config will stop working

**3. Migration Form Notice (migrate-account.html)**
- Blue info box before submit button
- Reminds user of next step after migration
- Links to /configure page

### Files Modified

**Backend:**
- `index.js` - User detection, middleware, migration API, migration route, create-user API
- `database/migrations/011_add_needs_addon_reconfiguration_column.js` - New migration
- `database/adapters/SQLiteAdapter.js` - Already has users table support

**Frontend:**
- `views/dashboard.ejs` - Alert banner, migration modal, countdown timer, addon reconfiguration alert
- `views/migrate-account.html` - Standalone migration page with addon reconfiguration warnings

**Documentation:**
- `internal-docs/authentication-system.md` - Migration system and addon reconfiguration documentation

---

## Implementation Checklist

### Initial Authentication System
- [x] Username required in configure.html
- [x] Username optional in login.html with hint
- [x] bcryptjs installed
- [x] Users table with password_bcrypt column
- [x] Migration 009 (create users table)
- [x] Migration 010 (add password_bcrypt column)
- [x] SQLiteAdapter auto-create users table
- [x] mysql-schema.sql updated
- [x] POST /api/create-user saves both hashes
- [x] POST /admin/auth maintains backward compatibility
- [x] Technical documentation created

### Account Migration System
- [x] detectUserType() function in index.js
- [x] attachUserInfo middleware in index.js
- [x] GET /api/user-info endpoint
- [x] POST /api/migrate-account endpoint
- [x] GET /admin/migrate route
- [x] Migration alert banner in dashboard.ejs
- [x] Migration modal in dashboard.ejs
- [x] Countdown timer functionality
- [x] Alert dismissal with localStorage
- [x] Migration page views/migrate-account.html
- [x] Migration deadline set (Nov 17, 2025)
- [x] Data transfer logic (UPDATE translation_queue)
- [x] Logout after migration
- [x] Error handling and user feedback
- [x] Migration system documentation

### Addon Reconfiguration System
- [x] Migration 011 (add needs_addon_reconfiguration column)
- [x] POST /api/migrate-account sets needs_addon_reconfiguration=true
- [x] POST /api/create-user sets needs_addon_reconfiguration=false for new users
- [x] POST /api/create-user clears flag when migrated user reconfigures
- [x] detectUserType() returns needsAddonReconfiguration flag
- [x] attachUserInfo middleware passes flag to views
- [x] Dashboard alert for addon reconfiguration (dashboard.ejs)
- [x] Migration page simplified and concise (migrate-account.html)
- [x] Addon reconfiguration warnings added (migrate-account.html)
- [x] Critical warning box in migration page
- [x] Next step notice in migration form
- [x] Direct links to /configure throughout UI
- [x] Complete addon reconfiguration documentation
- [x] Flow diagrams and code examples in docs
