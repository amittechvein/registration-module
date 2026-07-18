# Registration Module (Admissions)

Complete student registration module: dynamic form templates, class-wise form activation with statuses & notifications, public form with online payment (Razorpay), applicant tracking by phone number, submissions management, PDF/Excel exports and a dashboard.

**Stack:** Node.js (Express) + Sequelize (SQLite by default, MySQL-ready) + React (Vite) + Razorpay.

## Quick start

```bash
# 1) Server
cd server
npm install
copy .env.example .env      # (Windows) — edit as needed
npm start                   # http://localhost:5000

# 2) Client (dev, in a second terminal)
cd client
npm install
npm run dev                 # http://localhost:5173  (proxies /api to :5000)
```

**Production:** `cd client && npm run build` — the server automatically serves `client/dist`, so only `npm start` in `server/` is needed; everything runs on port 5000.

**Default admin login:** `admin@school.com` / `admin123` → change immediately (seeded on first run along with sessions 2026-27/2027-28 and classes Nursery–12).

## How it works

1. **Form Templates** (`/admin/templates`) — build a form: form name → sections (e.g. *Personal Details*) → fields (text, date, select, radio, checkbox, number, email, phone) with required flag and validations. Any field can be **linked to a student profile field** (Student Name, DOB, Father's Name, …).
2. **Active Forms** (`/admin/activations`) — publish a template for an **academic session + class**: form price, enable/disable **online payment**, **DOB validation** range, form number **prefix/suffix** (e.g. `REG-0001/26`), **instructions** (HTML editor), open/close dates, and the **status table**: first status, custom statuses, predefined **Allotted** status, per-status notification toggles (SMS / Email / WhatsApp) with message templates (`{{name}} {{form_no}} {{status}} {{class}} {{form}}`). Active/inactive toggle sits on the list page. Each activation gets a **public URL**: `/form/<slug>`.
3. **Public form** — applicant logs in with **phone number + OTP** (account auto-created), fills the form (**auto-saves as draft**, can resume/edit any time before submission), pays via **Razorpay** and receives a form number. Without Razorpay keys the app runs in **mock payment mode** for development.
4. **Track** (`/track`) — applicant sees status, full status history, and can **message the school** (two-way communication also available to admin under each submission).
5. **Submissions** (`/admin/submissions`) — table with filters on **form / session / class / status / payment / date range / form no / free-text search across all answers**, bulk status change, per-row PDF. Below each form: communication panel.
6. **Status update** — moving a form to **Allotted** automatically **inserts the student into the Students DB** using the linked fields (visible under *Allotted Students*), and fires the configured SMS/Email notifications.
7. **Exports** — all submissions as **Excel** (one column per form field) or combined **PDF**, plus individual PDF per form. **Dashboard** shows totals, fees collected, per-form status distribution and recent submissions.

## Configuration (`server/.env`)

| Key | Purpose |
|---|---|
| `DB_DIALECT` | `sqlite` (default, zero-setup) or `mysql` (+ `DB_HOST/PORT/NAME/USER/PASS`) |
| `RAZORPAY_KEY_ID/SECRET` | live payments; empty = mock payment mode |
| `SMTP_*` | email notifications; empty = logged to server console |
| `MSG91_AUTH_KEY` | SMS via MSG91; empty = logged to server console |
| `DEV_SHOW_OTP` | `true` shows OTP in the API response (dev only — set `false` in production) |
| `JWT_SECRET` | change in production |

## Integrating with your main ERP

The module is self-contained. To plug into your existing system: point `DB_DIALECT=mysql` at your ERP database, map the `Students` table in `server/src/models/index.js` to your student table's columns (the `STUDENT_FIELDS` list drives the template builder's link dropdown), and mount the two routers (`/api/admin`, `/api/public`) inside your API gateway.
