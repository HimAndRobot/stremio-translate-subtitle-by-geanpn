# Dashboard Tailwind CSS Conversion

## Overview
Complete conversion of the Stremio Translate Subtitle dashboard from legacy CSS to modern Tailwind CSS design system while maintaining all existing functionality.

**Date:** December 2025
**Scope:** Dashboard UI, Modals System, Series Cards, Loading States

---

## 1. Modal System Refactoring

### Problem
- Modals were using `style.display = 'block'/'none'` to control visibility
- New Tailwind modals use `hidden` and `flex` CSS classes
- Internal containers used Tailwind `hidden` class but JavaScript used `style.display`
- All modals were breaking due to class/style mismatch

### Solution

#### Created Helper Functions
```javascript
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => lucide.createIcons(), 50);
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}
```

#### Updated All Modal Functions
- `openMasterPasswordModal()` / `closeMasterPasswordModal()`
- `openAddSubtitleModal()` / `closeAddSubtitleModal()`
- `openReprocessModal()` / `closeReprocessModal()`
- `openIdentifyModal()`
- `previewSubtitle()` / `closeSubtitlePreview()`
- `openDownloadMoreModal()`

#### Fixed Internal Container Visibility
Changed from Tailwind classes to inline styles for JavaScript-controlled containers:
- `searchContainer`: `class="hidden"` → `style="display: none;"`
- `episodesSelectionContainer`: `class="hidden"` → `style="display: none;"`
- `modeSelectionContainer`: `class="hidden"` → `style="display: none;"`
- `subtitleCustomizationContainer`: `class="hidden"` → `style="display: none;"`
- `translationOptionsContainer`: `class="hidden"` → `style="display: none;"`

**Reasoning:** JavaScript uses `style.display = 'block'/'none'` for these containers, so inline styles provide better compatibility.

---

## 2. Button Selector Fixes

### Problem
JavaScript was searching for `.confirm-selection-btn` class that doesn't exist in Tailwind modals.

### Solution
Changed from class selectors to attribute selectors:

**Before:**
```javascript
const confirmBtn = document.querySelector('.confirm-selection-btn');
```

**After:**
```javascript
const confirmBtn = document.querySelector('#episodesSelectionContainer button[onclick="confirmSelection()"]');
const customBtn = document.querySelector('#subtitleCustomizationContainer button[onclick="proceedToTranslationOptions()"]');
```

Added null checks:
```javascript
if (confirmBtn) confirmBtn.disabled = true;
```

**Locations:** Lines 1073, 1184, 1247, 1337 in dashboard.ejs

---

## 3. Series Card Display Logic

### Problem
Series with only 1 episode were displaying as movies instead of showing the episode list.

### Solution
Changed condition from `> 1` to `>= 1`:

**Before:**
```ejs
<% if (!series.isMovie && series.episodes.length > 1) { %>
```

**After:**
```ejs
<% if (!series.isMovie && series.episodes.length >= 1) { %>
```

**File:** `views/dashboard.ejs:505`

---

## 4. Unified Modal Header System

### Problem
Each modal step had duplicated title/back button inside content area, creating visual clutter.

### Solution

#### Added Dynamic Header to Add Subtitle Modal
```html
<div class="flex items-center gap-3 flex-1">
    <button id="addSubtitleModalBackBtn" onclick="backToSearch()"
            class="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-500"
            style="display: none;">
        <i data-lucide="arrow-left" class="w-5 h-5"></i>
    </button>
    <div class="flex-1">
        <h2 id="addSubtitleModalTitle">Add Subtitle</h2>
        <p id="addSubtitleModalSubtitle">Translation Configuration</p>
    </div>
</div>
```

#### Removed Duplicated Headers from Content
Removed title/back button from:
- Episodes Selection Container (line 53-61)
- Mode Selection Container (line 72-76)
- Subtitle Customization Container (line 94-98)
- Translation Options Container (line 107-110)

#### JavaScript Header Control
Each navigation function now updates the header:

```javascript
function showModeSelection() {
    // ... hide/show containers ...
    document.getElementById('addSubtitleModalBackBtn').onclick = backToEpisodesFromMode;
    document.getElementById('addSubtitleModalSubtitle').textContent = 'CHOOSE TRANSLATION MODE';
}

function showSubtitleCustomization() {
    // ... hide/show containers ...
    document.getElementById('addSubtitleModalBackBtn').onclick = backToModeSelection;
    document.getElementById('addSubtitleModalSubtitle').textContent = 'CUSTOMIZE SUBTITLES';
}

function showTranslationOptions() {
    // ... hide/show containers ...
    document.getElementById('addSubtitleModalBackBtn').onclick = backToEpisodes;
    document.getElementById('addSubtitleModalSubtitle').textContent = 'TRANSLATION OPTIONS';
}

function backToSearch() {
    // ... hide/show containers ...
    document.getElementById('addSubtitleModalTitle').textContent = 'Add Subtitle';
    document.getElementById('addSubtitleModalSubtitle').textContent = 'Translation Configuration';
    document.getElementById('addSubtitleModalBackBtn').style.display = 'none';
}
```

**Benefits:**
- Single source of truth for modal title
- Cleaner UI without repetition
- Better mobile responsiveness
- Dynamic back button with context-aware navigation

---

## 5. Loading States Modernization

### Problem
Loading states used legacy HTML/CSS patterns inconsistent with Tailwind design.

### Solution

#### Subtitle Customization Loading
**Before:**
```javascript
content.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Loading subtitle options...</p></div>';
```

**After:**
```javascript
content.innerHTML = `
    <div class="text-center py-8">
        <div class="inline-block w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin"></div>
        <p class="text-sm text-slate-400 mt-3 font-medium">Loading subtitle options...</p>
    </div>
`;
```

#### Subtitle Preview Loading
**Before:**
```javascript
loadingDiv.style.display = 'block';
// ...
loadingDiv.style.display = 'none';
```

**After:**
```javascript
loadingDiv.classList.remove('hidden');
// ...
loadingDiv.classList.add('hidden');
```

**All Loading States Now Use:**
- Tailwind spinner: `animate-spin` with border animation
- Consistent text styling: `text-sm text-slate-400 mt-3 font-medium`
- Centered layout: `text-center py-8`

---

## 6. Download More Episode Filtering

### Problem
"Download More" button showed ALL episodes including those already translated.

### Solution
Filter out existing episodes before displaying:

```javascript
async function openDownloadMoreModal(imdbId, seriesName) {
    // ... existing code ...

    const response = await fetch('/api/episodes/' + imdbId);
    const data = await response.json();

    // Find existing episodes for this series
    const existingSeries = seriesData.find(s => s.series_imdbid === imdbId);
    const existingEpisodes = existingSeries ? existingSeries.episodes : [];

    // Filter out episodes that already exist
    const availableEpisodes = data.episodes.filter(episode => {
        const season = episode.season || 0;
        const episodeNum = episode.episode || 0;
        return !existingEpisodes.some(existing =>
            existing.series_seasonno === season && existing.series_episodeno === episodeNum
        );
    });

    if (availableEpisodes.length > 0) {
        // Display available episodes
    } else {
        episodesGrid.innerHTML = '<p>All episodes already translated</p>';
    }
}
```

**File:** `views/dashboard.ejs:1103-1147`

---

## 7. Scroll Chaining Prevention

### Problem
When scrolling to the end of modal content, the scroll would continue to the main page behind the modal (scroll chaining).

### Solution
Added `overscroll-contain` to all scrollable containers:

```html
<!-- Episodes Modal -->
<div id="episodesModalBody" class="... overflow-y-auto overscroll-contain ...">

<!-- Search Results -->
<div id="searchResultsGrid" class="... overflow-y-auto overscroll-contain ...">

<!-- Episodes Grid -->
<div id="episodesGrid" class="... overflow-y-auto overscroll-contain ...">

<!-- Subtitle Customization -->
<div id="subtitleCustomizationContent" class="... overflow-y-auto overscroll-contain ...">

<!-- Subtitle Preview -->
<div class="... overflow-y-auto overscroll-contain ...">
```

**CSS Property:** `overscroll-behavior: contain;`
**Effect:** Prevents scroll events from propagating to parent elements

**Files Modified:**
- `views/partials/modals.ejs` (lines 13, 53, 62, 84, 268)

---

## 8. Reset Modal State Function

### Problem
Modal state wasn't being properly reset when closed or reopened.

### Solution
Enhanced `resetAddSubtitleModal()` to reset header state:

```javascript
function resetAddSubtitleModal() {
    // Hide all containers
    document.getElementById('searchContainer').style.display = 'none';
    document.getElementById('episodesSelectionContainer').style.display = 'none';
    document.getElementById('modeSelectionContainer').style.display = 'none';
    document.getElementById('subtitleCustomizationContainer').style.display = 'none';
    document.getElementById('translationOptionsContainer').style.display = 'none';

    // Clear content
    document.getElementById('searchModalInput').value = '';
    document.getElementById('searchResultsGrid').innerHTML = '';
    document.getElementById('episodesGrid').innerHTML = '';

    // Reset header state
    document.getElementById('addSubtitleModalTitle').textContent = 'Add Subtitle';
    document.getElementById('addSubtitleModalSubtitle').textContent = 'Translation Configuration';
    document.getElementById('addSubtitleModalBackBtn').style.display = 'none';

    // Reset data
    selectedEpisodes = [];
    currentSelectedSeries = null;
    customSubtitles = {};
    isAutomaticMode = true;
}
```

---

## 9. Lucide Icons Integration

### Problem
Icons weren't rendering properly when modals opened dynamically.

### Solution
Added automatic icon initialization to `openModal()` helper:

```javascript
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => lucide.createIcons(), 50);  // ← Auto-render icons
    }
}
```

**Why 50ms delay:** Ensures DOM is fully rendered before icon replacement

---

## Technical Decisions

### 1. Why `style.display` for Internal Containers?
**Decision:** Use inline styles for containers controlled by JavaScript
**Reasoning:**
- JavaScript already uses `style.display = 'block'/'none'`
- Mixing Tailwind classes with inline styles causes conflicts
- Inline styles provide explicit control needed for dynamic visibility

### 2. Why Helper Functions Instead of Direct Calls?
**Decision:** Centralize modal control in `openModal()`/`closeModal()`
**Reasoning:**
- Single source of truth for modal behavior
- Ensures consistent icon rendering
- Easier to add global modal behaviors (analytics, focus management, etc.)
- Reduces code duplication

### 3. Why Attribute Selectors Over Class Selectors?
**Decision:** Use `querySelector('[onclick="..."]')` for buttons
**Reasoning:**
- Tailwind doesn't use semantic class names like `.confirm-selection-btn`
- Attribute selectors are more resilient to CSS changes
- Explicit targeting reduces selector collisions

---

## Files Modified

### Core Files
1. **views/dashboard.ejs** - Main dashboard JavaScript and logic
2. **views/partials/modals.ejs** - All modal HTML structures

### Key Line Ranges

#### dashboard.ejs
- **767-782:** Modal helper functions
- **893-904:** Master password modal functions
- **1052-1071:** Reset and open/close modal functions
- **1079-1148:** Download more modal with episode filtering
- **1281-1289:** Back to search function with header reset
- **1300-1318:** Mode selection navigation
- **1332-1347:** Subtitle customization with header control
- **1485-1492:** Translation options with header control
- **1574-1579:** Back to episodes function
- **1783-1806:** Subtitle preview with Tailwind loading

#### modals.ejs
- **13:** Episodes modal body scroll fix
- **25-38:** Unified add subtitle modal header
- **53:** Search results scroll fix
- **57-64:** Episodes selection (removed duplicate header)
- **67-80:** Mode selection (removed duplicate header)
- **83-86:** Subtitle customization (removed duplicate header)
- **89-138:** Translation options (removed duplicate header)
- **268:** Subtitle preview scroll fix

---

## Final Status

All conversion tasks completed successfully:

✅ **Modal System** - All 6 modals (Episodes, Add Subtitle, Reprocess, Master Password, Account Migration, Subtitle Preview) now use Tailwind CSS classes with `openModal()`/`closeModal()` helper functions

✅ **Unified Header** - Add Subtitle modal now has single dynamic header with back button that updates per step, eliminating duplication

✅ **Button Selectors** - Fixed all null pointer errors by using attribute selectors with null checks

✅ **Series Display** - Series with 1 episode now correctly display episode list instead of movie layout

✅ **Loading States** - All loading spinners converted to Tailwind design with consistent styling

✅ **Episode Filtering** - Download More modal filters out already-translated episodes

✅ **Scroll Fix** - Added `overscroll-contain` to all modal scroll areas to prevent scroll chaining to main page

✅ **Icon Rendering** - Lucide icons auto-initialize when modals open via `setTimeout(() => lucide.createIcons(), 50)`

All functionality tested and working correctly. The dashboard maintains 100% feature parity with improved code structure and modern Tailwind CSS design.
