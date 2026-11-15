# App Builder (UI automation)

The App Builder turns workflows and data tables into real user interfaces. You drag components onto a canvas, style every detail, bind data with expressions, wire events to actions and publish the result as a web app at `/a/<slug>`.

Typical apps: internal admin panels, approval consoles, dashboards, customer portals, intake forms, landing pages and AI chat front-ends.

## Building blocks

| Concept | What it is |
|---|---|
| **App** | Pages + queries + state + theme, stored as one JSON definition (`AppDefinition` in `@simplyai/shared`). |
| **Page** | A URL (`?page=<path>`) with a component tree and optional on-load actions. The first page is the home page. |
| **Component** | A node of the tree: `type`, unique `name`, `props`, `style` (+ `hoverStyle`, `tabletStyle`, `mobileStyle`), `animation`, `events`, `visible`, `hideOn`, `children`. |
| **Query** | Server-side data access: *Workflow* (App Trigger), *Data table* (list/get/insert/update/delete) or *Static* JSON. |
| **State** | App-wide variables (`state.name`) changed with the *Set state* action. |
| **Theme** | Colors, fonts, radius, light/dark mode, automatic navigation, max content width. Exposed as CSS variables (`--app-primary`, `--app-accent`, `--app-bg`, `--app-surface`, `--app-text`, `--app-muted`, `--app-border`, `--app-radius`, `--app-font`, `--app-heading-font`). |

## Components (37)

* **Layout** – Container (flex), Grid, Card, Tabs, Modal, List / Repeater, Divider, Spacer
* **Text** – Heading, Text, Markdown
* **Inputs** – Form, Button, Text input, Text area, Select, Radio group, Checkbox, Switch, Date picker, Slider, Rating, Color picker
* **Data** – Table (search, sort, pagination, row selection), Chart (bar, line, area, pie, donut, radial), Stat / KPI
* **Feedback** – Progress, Badge, Alert
* **Media** – Image, Icon (any Lucide icon), Avatar, Video (YouTube, Vimeo, MP4), Embed (sandboxed https iframe)
* **Navigation** – Link, Navigation bar

Ready-made **blocks** (gradient hero, KPI row, feature cards, contact form, search + table, pricing tiers) and five **templates** (blank, revenue dashboard, CRM admin panel, landing page, AI assistant) are included.

## Editor

* **Insert** – drag components or blocks onto the canvas (or click to add them to the selected container). A drop indicator shows exactly where the component lands; drop near the edge of a container to place it beside the container instead of inside.
* **Layers** – the component tree; drag rows to reorder or nest (drop in the middle of a container row to move inside).
* **Pages** – add, rename, hide, delete pages and choose the home page.
* **Data** – queries and state variables, with a *Run* button and the last result.
* **Inspector** – *Props*, *Style*, *Events* and *Advanced* (visibility rules, hide per device, lock, raw JSON).
* **Style editor** – layout (flex/grid, direction, wrap, alignment, gap, column templates, grid spans), size, padding/margin box editor, typography (16 Google fonts, size, weight, spacing, alignment, case, text effects incl. gradient text), background (color, gradient builder with presets, image), border and radius, effects (shadow presets incl. glow/neon/brutal, opacity, blur, glass backdrop, rotate/scale/move/skew, transitions, cursor, blend modes, clip shapes), position, motion (fade, slide, zoom, bounce, pulse, float, spin, shake) and free-form CSS properties. Edit **Default**, **Hover**, **Tablet** and **Mobile** states separately.
* **Canvas** – desktop / tablet (768px) / mobile (390px) frames, zoom, selection toolbar (select parent, move, duplicate, delete), hover outlines.
* **Preview** – interact with the draft inside the editor, or open it in a new tab.
* **Shortcuts** – Ctrl+Z / Ctrl+Shift+Z undo/redo, Ctrl+C / Ctrl+V copy and paste, Ctrl+D duplicate, Delete, Esc selects the parent.
* **Autosave** – the draft saves about a second after each change.

## Bindings

Every prop and style value accepts `{{ expressions }}` evaluated live with the sandboxed expression language used by workflows (no `eval`, whitelisted methods). Missing properties read as `undefined` instead of failing.

| In scope | Example |
|---|---|
| Inputs | `{{ emailInput.value }}` |
| Forms | `{{ signupForm.data }}` (all inputs inside, keyed by name) |
| Tables | `{{ ordersTable.selectedRow.id }}`, `.selectedIndex`, `.searchText` |
| Tabs / modals | `{{ tabs1.activeTab }}`, `{{ editModal.open }}` |
| Queries | `{{ getLeads.data }}`, `.meta.total`, `.loading`, `.error` |
| State | `{{ state.cart.length }}` |
| Lists | `{{ item.title }}`, `{{ index }}` |
| Context | `{{ user.email }}`, `{{ url.ref }}`, `{{ page.name }}`, `{{ app.name }}` |
| Event data | `row` (table row click), `value` (input change), `data` (form submit), `item` (list item click) |

## Events and actions

Events: `onClick`, `onChange`, `onSubmit` (forms, Enter in inputs), `onRowClick`, `onItemClick`, `onClose` (modals), page on-load, query on-success / on-error.

Actions run in order and may have an *only when* condition: run query, set state, go to page, open URL (http/https/mailto/tel only), show notification, open / close modal, set input value, reset inputs, copy to clipboard, scroll to component, download (JSON, or CSV for arrays of objects).

## Queries and security

Queries are resolved **on the server from the stored definition**. The browser only sends the query id and the evaluated arguments:

* **Workflow** – starts the workflow's **App Trigger** with the payload as the output item and returns the output of the last executed node (`data` is the object when there is one item, otherwise an array). The builder preview runs the workflow *draft*; published apps run the *active* version (activate the workflow). Executions use mode `APP` and count towards plan quotas. Timeout: 60 s.
* **Data table** – `list` (search, exact `filters`, sort, order, page, pageSize ≤ 500), `get`, `insert`, `update`, `delete` on a table of the app's own workspace. Values are coerced to column types; unknown columns are ignored.
* **Static** – JSON defined in the app; useful for mock data or as an action chain.

Access:

* **Private** apps require sign-in and membership of the workspace with the `app:read` permission (all system roles).
* **Public** apps can be opened by anyone with the link, and their queries can be run by anyone with the arguments the app accepts. Keep sensitive writes in private apps or behind a workflow that performs its own checks.
* Building apps requires `app:manage` (Owner, Admin, Editor).

Rendering is XSS-safe: text is rendered as text, Markdown is converted to React elements (no HTML), URLs are restricted to `http(s)`, `mailto`, `tel`, in-app paths and image data URLs, CSS properties are whitelisted and values containing `url()` to non-https hosts, `javascript:`, `expression()` or `@import` are dropped, and embeds use sandboxed iframes.

## Publishing

*Publish* snapshots the draft as a new `AppVersion`; the live URL always serves the latest published version while you keep editing. Versions can be restored into the draft. *Share* sets the URL slug and the access mode. *Unpublish* takes the app offline.

## Demo

The seed creates **Lead Manager** (`/a/lead-manager-demo`): a published, private app on the demo *Leads* data table with search, filters, KPIs, a new-lead form in a modal, row details, update and delete actions, an insights page with charts, and a **Score with workflow** button backed by the active *Lead Scoring (app)* workflow.
