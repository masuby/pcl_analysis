# Gap Analysis – Simple process for Team Leaders

Team leaders can submit their **Actual Sales Rep** count in two ways. Choose one.

---

## Your form and sheet (current setup)

- **Form (edit):** [ACTUAL SALES REPS](https://docs.google.com/forms/d/1MmIbDpjfnNwx7-u7YCXLKhiEewRJHCImqSZJXLUsVhk/edit)
- **Form (respond):** [viewform](https://docs.google.com/forms/d/e/1FAIpQLSepRwySnl_fPLvOy7mKnl6bX35X_tDpKW-YBlQjnxaoTjORuw/viewform)
- **Sheet (Form responses):** [ACTUAL SALES REPS TRACKER](https://docs.google.com/spreadsheets/d/11S_fypHqxt5JtCSbdrU8zy-VounqxQeEthC8NIgqEWQ/edit#gid=117540997) — tab **Form_Responses** (GID `117540997`)

**Backend:** In `backend/.env` set:
- `GAP_GOOGLE_SHEET_ID=11S_fypHqxt5JtCSbdrU8zy-VounqxQeEthC8NIgqEWQ`
- `GAP_GOOGLE_SHEET_GID=117540997` (so "Refresh from Sheet" reads the Form_Responses tab)

**Frontend:** In `.env.local`, `VITE_GAP_GOOGLE_FORM_URL_TEMPLATE` is set to the form viewform URL. To pre-fill each TL’s name and supervision on the form, get the pre-filled link (see Option B below) and put that URL with placeholders `{reportId}`, `{tlKey}`, `{product}`, `{tlName}`, `{supervision}` into `VITE_GAP_GOOGLE_FORM_URL_TEMPLATE`.

The sheet columns (Timestamp, Report ID, Team Leader Key, Product, Your name, Your supervision, *How many Sales Reps do you have ( Actual Sales Reps) ?*) are all recognized; the app uses Report ID, Team Leader Key, and the Actual Sales Reps column when merging data.

---

## Option A: Google Sheet only (no form)

**For you (HOD):**
1. Create a Google Sheet with **row 1** as headers: `ReportId`, `TeamLeaderKey`, `Product`, `ActualReps`.
2. Set `GAP_GOOGLE_SHEET_ID` in backend `.env` (and publish the sheet to web so we can read it).
3. Before sending emails, click **"Copy team list for sheet"** in Gap Analysis. Paste the copied table into **row 2** of your sheet (so each team leader already has a row with their name/supervision).
4. Send emails. Each email will tell the team leader: *"Find the row with your name and supervision, then type your number in the Actual Reps column."*

**For team leaders:**
1. Click the button in the email.
2. Open the sheet and find **their** row (name + supervision).
3. Type their number in the **Actual Reps** column. Done.

---

## Option B: Google Form (name + supervision on form, then one field)

When a team leader opens their link, they see **their name and supervision** on the form (each person only sees their own details), then **one question**: "Actual number of Sales Reps" and Submit. Values sync to your Google Sheet.

**Setup:**
1. Create a **Google Form** with:
   - **5 short-answer questions** (pre-filled via the link so the TL sees their details):
     - "Report ID"
     - "Team Leader Key"
     - "Product"
     - **"Your name"** – so when they open the form they see their name
     - **"Your supervision"** – so they see their supervision
   - **1 number question**: "Actual number of Sales Reps" (the only one they fill).
2. In the form, click **⋮ (top right) → Get pre-filled link**. Fill the first five questions with sample values; leave *"How many Sales Reps do you have ( Actual Sales Reps) ?"* empty. Click **Get link**. The URL will contain `entry.XXXXX=value` for each field.
3. Copy that URL and replace only the **sample values** with placeholders (keep the `entry.XXXXX` numbers). Put the result in `.env.local` as `VITE_GAP_GOOGLE_FORM_URL_TEMPLATE`. Use `{reportId}`, `{tlKey}`, `{product}`, `{tlName}`, `{supervision}`.
4. Link the form to a **Google Sheet** (Form → Responses → Link to Sheets). That sheet will get one column per question. Our app reads from that sheet (set `GAP_GOOGLE_SHEET_ID` to the response sheet). We match rows by `ReportId`, `TeamLeaderKey`, `Product`; columns like "Your name" / "Your supervision" are optional for display.
5. Restart the frontend. From then on, each email link opens the **form** with that TL's name and supervision pre-filled. They enter the number and submit; responses sync to the sheet.

**For team leaders:**
1. Click the green button in the email.
2. On the form they see their name and supervision (pre-filled).
3. Enter their Actual number of Sales Reps and click Submit. Done.

---

## Summary

| You want…                    | Use                        |
|-----------------------------|----------------------------|
| Easiest for team leaders    | **Option B (Form)**        |
| Keep using the sheet only   | **Option A** + "Copy team list for sheet" |

In both cases, you click **"Refresh from Sheet"** in Gap Analysis to load their answers into the report.
