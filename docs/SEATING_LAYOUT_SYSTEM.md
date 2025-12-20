# Seating Layout System - Implementation Guide

## Overview

The seating chart system now supports:
1. **Default (non-interactive) seating chart** on the homepage
2. **Multiple saved layout templates** that can be reused
3. **Event-specific layouts** with interactive seat selection
4. **Layout assignment** to individual events

## Database Changes

### New Table: `seating_layouts`
Stores named layout templates that can be assigned to events.

```sql
CREATE TABLE seating_layouts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_default TINYINT(1) DEFAULT 0,
  layout_data JSON NOT NULL,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### Modified Tables:
- **`events`**: Added `layout_id` column to link events to specific layouts
- **`seating`**: Added `layout_id` column for tracking (optional)

### Migration Script
Run: `database/seating_layouts_migration.sql`

## API Endpoints Added

### Seating Layouts Management

**GET `/api/seating-layouts`**
- Returns all saved layout templates
- Ordered by default first, then alphabetically

**GET `/api/seating-layouts/:id`**
- Get a specific layout by ID

**GET `/api/seating-layouts/default`**
- Get the default layout (shown on homepage)

**POST `/api/seating-layouts`**
- Create a new layout template
- Body: `{ name, description, is_default, layout_data }`
- If `is_default` is true, unsets other defaults

**PUT `/api/seating-layouts/:id`**
- Update an existing layout
- Body: `{ name, description, is_default, layout_data }`

**DELETE `/api/seating-layouts/:id`**
- Delete a layout (cannot delete default)
- Unlinks from events automatically

### Event Seating

**GET `/api/seating/event/:eventId`**
- Returns seating layout for a specific event
- Uses event's `layout_id` if assigned, otherwise uses default
- Includes `reservedSeats` and `pendingSeats` arrays
- Response:
  ```json
  {
    "success": true,
    "seating": [...layout data...],
    "reservedSeats": ["Main-A-1", "Main-A-2"],
    "pendingSeats": ["Main-B-3"]
  }
  ```

## Frontend Implementation Plan

### 1. Homepage - Non-Interactive Chart

**Location:** `frontend/src/pages/HomePage.js`

Update to show default layout (non-interactive):
```javascript
// Fetch default layout
const res = await fetch(`${API_BASE}/seating-layouts/default`);
const data = await res.json();
const defaultLayout = data.layout?.layout_data || [];

// Pass to SeatingChart with interactive=false
<SeatingChart 
  seatingConfig={defaultLayout} 
  interactive={false}
  showLegend={true}
/>
```

### 2. Event Pages - Interactive Chart

**New Component:** `frontend/src/pages/EventPage.js`

For individual event pages with seat selection:
```javascript
// Fetch event-specific seating
const res = await fetch(`${API_BASE}/seating/event/${eventId}`);
const data = await res.json();

<SeatingChart 
  seatingConfig={data.seating}
  reservedSeats={data.reservedSeats}
  pendingSeats={data.pendingSeats}
  interactive={true}
  eventId={eventId}
  events={[currentEvent]}
/>
```

### 3. Update SeatingChart Component

**File:** `frontend/src/components/SeatingChart.js`

Add `interactive` prop to control behavior:
```javascript
export default function SeatingChart({ 
  seatingConfig = [], 
  events = [],
  interactive = true,  // NEW: controls if seats can be selected
  reservedSeats = [], // NEW: seats that are reserved
  pendingSeats = [],  // NEW: seats pending approval
  eventId = null      // NEW: specific event ID
}) {
  // Only allow seat selection if interactive=true
  const toggleSeat = (id) => {
    if (!interactive) return; // Don't allow selection
    // ... existing toggle logic
  };

  // Hide request button if not interactive
  {interactive && (
    <button onClick={openRequestModal}>
      Request Seats
    </button>
  )}
}
```

### 4. Admin Layout Manager

**New Component:** `frontend/src/admin/LayoutsModule.js`

Admin UI to:
- List all saved layouts
- Create new layouts
- Edit existing layouts
- Set default layout
- Delete layouts
- Preview layouts

Features:
- Visual layout editor (drag/drop tables)
- Save as template with name
- Duplicate existing layouts
- Assign to events

### 5. Update Events Module

**File:** `frontend/src/admin/EventsModule.js`

Add layout selector to event form:
```javascript
const [layouts, setLayouts] = useState([]);

// Fetch layouts
useEffect(() => {
  fetch(`${API_BASE}/seating-layouts`)
    .then(res => res.json())
    .then(data => setLayouts(data.layouts || []));
}, []);

// In form
<select 
  name="layout_id" 
  value={form.layout_id || ''} 
  onChange={handleChange}
>
  <option value="">Use Default Layout</option>
  {layouts.map(layout => (
    <option key={layout.id} value={layout.id}>
      {layout.name}
    </option>
  ))}
</select>
```

## Usage Workflow

### Admin Workflow:

1. **Create Layout Templates**
   - Go to Admin → Layouts
   - Click "New Layout"
   - Design seating arrangement
   - Save with descriptive name (e.g., "Theater Style", "Cabaret Setup")

2. **Set Default Layout**
   - Mark one layout as "Default"
   - This appears on homepage (non-interactive)

3. **Assign Layout to Event**
   - Go to Admin → Events
   - Create/Edit event
   - Select layout from dropdown
   - Save event

4. **Refresh Layout Snapshot (when templates change)**
   - While editing an event that already has a layout assigned, click **"Apply latest layout template"**
   - The admin UI calls `POST /api/events/:id/refresh-layout`, snapshots the template, and updates the event’s `layout_version_id`
   - Use whenever tables/chairs are added or removed so the public picker reflects the latest blueprint without re-entering event data

### Customer Workflow:

1. **View Homepage**
   - See default seating chart
   - NOT interactive (just for reference)

2. **View Event Details**
   - Click on specific event
   - See event-specific layout
   - INTERACTIVE - can select seats
   - Submit seat request

3. **Seat Request**
   - Select desired seats
   - Fill in contact info
   - Submit request
   - Seats show as "pending"

### Admin Approval:

1. **Review Requests**
   - Go to Admin → Seat Requests
   - See all pending requests
   - Approve or deny
   - System handles conflicts automatically

## Next Steps

1. ✅ **Database Migration** - Run `seating_layouts_migration.sql`
2. ✅ **API Endpoints** - Already added to `backend/index.php`
3. ⏳ **Frontend Updates** - Need to implement:
   - Update HomePage to use default layout (non-interactive)
   - Create EventPage component for individual events
   - Add `interactive` prop to SeatingChart
   - Create LayoutsModule admin component
   - Update EventsModule with layout selector

## Testing Checklist

- [ ] Run database migration successfully
- [ ] Create a default layout via API
- [ ] Create additional layout templates
- [ ] Assign layout to test event
- [ ] Verify homepage shows default layout (non-interactive)
- [ ] Verify event page shows assigned layout (interactive)
- [ ] Test seat selection and request submission
- [ ] Test admin layout management
- [ ] Test layout assignment to events
- [ ] Verify reserved/pending seats display correctly

## Notes

- Default layout is required - system will error if none exists
- Cannot delete the default layout
- Deleting a layout unlinks it from events (they fall back to default)
- Layout data stored as JSON for flexibility
- Seat requests still use existing approval flow
- No breaking changes to existing seating system

## Layout Versioning & Event Refresh

- Saving an event with a `layout_id` immediately snapshots the template into `seating_layout_versions` and stores that `layout_version_id` on the event.
- Seat requests, previews, and public seat pickers always read from that frozen version so guest communications stay consistent even if the template changes later.
- Editing a layout template does **not** update events that already captured a version — staff must edit each event (or reassign the layout) to pull in the new seating.

### Layout Refresh Control

- Admins now have an **“Apply latest layout template”** action inside the event editor.
- The button invokes `POST /api/events/:id/refresh-layout`, snapshots the assigned template, updates `layout_version_id`, and logs `event.layout.refresh` in the audit log.
- Pending and approved seat requests remain intact because reservations live in `seat_requests`; the refresh only changes what future viewers see.
- Use the control whenever a template is edited after events have already been configured so the dancefloor layout matches reality without re-entering the event.

---

**Created:** November 30, 2025  
**Status:** Backend complete, frontend implementation pending  
**Migration Required:** Yes - run `seating_layouts_migration.sql`
