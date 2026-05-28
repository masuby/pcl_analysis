"""
PCL Analysis System — PDF Document Generator
Generates a professional, beautifully styled PDF (max 5 pages) from the system documentation.
Uses the same color palette as the Score Card Reports dashboard.

Requirements:
    pip install fpdf2

Usage:
    python generate_system_pdf.py
"""

from fpdf import FPDF
import os

# ── Color palette (from ScoreCardReports.css) ──────────────────────────────
PRIMARY      = (30, 58, 95)     # #1e3a5f  — deep navy (headers, gradients)
PRIMARY_MID  = (42, 82, 152)    # #2a5298  — medium blue (titles, accents)
PRIMARY_LIGHT= (59, 130, 246)   # #3b82f6  — lighter blue (links, highlights)
ACCENT_TEAL  = (15, 118, 110)   # #0f766e  — teal (secondary accent)
WHITE        = (255, 255, 255)
OFF_WHITE    = (248, 250, 252)  # #f8fafc
LIGHT_GRAY   = (226, 232, 240)  # #e2e8f0
MID_GRAY     = (100, 116, 139)  # #64748b
DARK_TEXT     = (30, 41, 59)    # #1e293b
DARK_SUB      = (71, 85, 105)   # #475569


def safe(text):
    """Replace Unicode chars with ASCII equivalents for core font compatibility."""
    return (text
        .replace("\u2014", " - ")
        .replace("\u2013", "-")
        .replace("\u2022", "-")
        .replace("\u2018", "'").replace("\u2019", "'")
        .replace("\u201c", '"').replace("\u201d", '"')
        .replace("\u2026", "...")
        .replace("\u2192", "->")
        .replace("\u2265", ">=").replace("\u2264", "<=")
        .replace("\u2260", "!=")
        .replace(">", ">").replace("<", "<")
    )


class PCLDocument(FPDF):
    """Custom PDF with PCL branding: header stripe, footer, and helper methods."""

    def header(self):
        if self.page_no() == 1:
            return  # cover page draws its own header
        self.set_fill_color(*PRIMARY)
        self.rect(0, 0, 210, 6, "F")
        self.set_font("Helvetica", "B", 7)
        self.set_text_color(*WHITE)
        self.set_xy(10, 0.5)
        self.cell(0, 5, "PCL ANALYSIS SYSTEM", align="L")
        self.set_font("Helvetica", "", 7)
        self.set_xy(10, 0.5)
        self.cell(0, 5, "Confidential", align="R")
        self.set_text_color(*DARK_TEXT)
        self.ln(8)

    def footer(self):
        if self.page_no() == 1:
            return
        self.set_y(-10)
        self.set_font("Helvetica", "I", 7)
        self.set_text_color(*MID_GRAY)
        self.cell(0, 5, f"Page {self.page_no() - 1}", align="C")

    # ── helpers ──────────────────────────────────────────────────────────
    def section_title(self, text):
        self.set_font("Helvetica", "B", 13)
        self.set_text_color(*PRIMARY)
        self.cell(0, 7, safe(text), new_x="LMARGIN", new_y="NEXT")
        self.set_fill_color(*PRIMARY_MID)
        self.rect(self.l_margin, self.get_y(), 40, 0.7, "F")
        self.ln(3)

    def sub_title(self, text):
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(*PRIMARY_MID)
        self.cell(0, 6, safe(text), new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def body_text(self, text):
        self.set_font("Helvetica", "", 8.5)
        self.set_text_color(*DARK_TEXT)
        self.multi_cell(0, 4.2, safe(text))
        self.ln(1.5)

    def bullet(self, text, indent=10):
        self.set_font("Helvetica", "", 8.5)
        self.set_text_color(*DARK_TEXT)
        x0 = self.l_margin + indent
        self.set_x(x0)
        self.cell(4, 4.2, "-")
        self.multi_cell(self.w - self.r_margin - x0 - 4, 4.2, safe(text))

    def kv_row(self, key, value, fill=False):
        if fill:
            self.set_fill_color(*OFF_WHITE)
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(*PRIMARY)
        self.cell(52, 5.5, safe(key), border=0, fill=fill)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*DARK_TEXT)
        self.cell(0, 5.5, safe(value), border=0, fill=fill, new_x="LMARGIN", new_y="NEXT")

    def table_header(self, cols, widths):
        self.set_fill_color(*PRIMARY)
        self.set_text_color(*WHITE)
        self.set_font("Helvetica", "B", 7.5)
        for i, col in enumerate(cols):
            self.cell(widths[i], 5.5, safe(col), border=0, fill=True, align="C")
        self.ln()

    def table_row(self, cells, widths, fill=False):
        if fill:
            self.set_fill_color(*OFF_WHITE)
        self.set_font("Helvetica", "", 7.5)
        self.set_text_color(*DARK_TEXT)
        for i, cell in enumerate(cells):
            self.cell(widths[i], 5, safe(cell), border=0, fill=fill, align="C" if i > 0 else "L")
        self.ln()

    def colored_badge(self, text, bg, fg=WHITE):
        self.set_fill_color(*bg)
        self.set_text_color(*fg)
        self.set_font("Helvetica", "B", 7)
        w = self.get_string_width(text) + 6
        self.cell(w, 4.5, text, fill=True, align="C")
        self.set_text_color(*DARK_TEXT)
        self.cell(3)  # spacer


def build_pdf():
    pdf = PCLDocument("P", "mm", "A4")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.set_left_margin(14)
    pdf.set_right_margin(14)

    # ═══════════════════════════════════════════════════════════════
    # PAGE 1 — COVER
    # ═══════════════════════════════════════════════════════════════
    pdf.add_page()

    # full-page navy background
    pdf.set_fill_color(*PRIMARY)
    pdf.rect(0, 0, 210, 297, "F")

    # decorative accent bar
    pdf.set_fill_color(*PRIMARY_MID)
    pdf.rect(0, 85, 210, 3, "F")
    pdf.set_fill_color(*ACCENT_TEAL)
    pdf.rect(0, 88, 210, 1.2, "F")

    # title block
    pdf.set_y(100)
    pdf.set_font("Helvetica", "B", 32)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 14, "PCL ANALYSIS", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 32)
    pdf.cell(0, 14, "SYSTEM", align="C", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(4)
    pdf.set_fill_color(*ACCENT_TEAL)
    pdf.rect(70, pdf.get_y(), 70, 0.8, "F")
    pdf.ln(6)

    pdf.set_font("Helvetica", "", 12)
    pdf.set_text_color(200, 210, 230)
    pdf.cell(0, 7, "Comprehensive System Documentation", align="C", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(20)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(170, 185, 210)
    pdf.cell(0, 5, "Developed by", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 6, "Daniel Clement Masubi", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 8.5)
    pdf.set_text_color(170, 185, 210)
    pdf.cell(0, 5, "Senior Data Analyst & Sales Support, PCL", align="C", new_x="LMARGIN", new_y="NEXT")

    pdf.set_y(272)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(130, 150, 180)
    pdf.cell(0, 4, "February 2026  |  Confidential", align="C")

    # ═══════════════════════════════════════════════════════════════
    # PAGE 2 — INTRODUCTION + SYSTEM OVERVIEW
    # ═══════════════════════════════════════════════════════════════
    pdf.add_page()

    pdf.section_title("1. Introduction")
    pdf.body_text(
        "The PCL Analysis System is a comprehensive, web-based analytical platform designed as a "
        "stand-alone reporting and analysis engine for Platinum Credit Limited (PCL). It automates "
        "the generation, visualization, and distribution of all key reports the company needs \u2014 from "
        "management reports to KPI tracking, gap analysis, CRM analytics, call center performance, "
        "sales reviews, and score cards."
    )
    pdf.body_text(
        "The system replaces manual, scattered Excel-based reporting with a single unified platform "
        "that delivers greater accuracy (automated calculations eliminate human error), timely delivery "
        "(reports generated instantly), comprehensive coverage (all departments in one place), and "
        "actionable insights (data analyzed, graded, and color-coded)."
    )

    pdf.section_title("2. System Overview")
    pdf.body_text(
        "The system is organized around a central Dashboard with seven analytical views, accessible "
        "from the top navigation bar. Three departments are fully supported: CS (Civil Servant), "
        "LBF (Log Book Finance), and SME (Small & Medium Enterprise)."
    )

    views = [
        ("SUMMARY", "Executive snapshot \u2014 one-page overview of all key metrics"),
        ("MANAGEMENT", "Deep analysis of uploaded management reports (Country / Cluster / Regional views)"),
        ("CRM", "Customer Relationship Management analytics (leads, consent, agent activity)"),
        ("CALL CENTER", "Call volumes, success rates, top agents, inbound/outbound split"),
        ("MTD", "Month-to-date operational reporting at supervision and team leader level"),
                ("DEPARTMENTAL", "Score Card, Sales Review, Gap Analysis, KPI Analysis, Social Media, Settlements, Temporary Reports, Marketing Analysis, RSM Score Card"),
        ("CHALLENGE", "Staff motivational challenges and contests \u2014 fully operational with live tracking"),
    ]
    w = [36, 146]
    pdf.table_header(["Dashboard View", "Description"], w)
    for i, (v, d) in enumerate(views):
        pdf.table_row([v, d], w, fill=(i % 2 == 0))
    pdf.ln(3)

    pdf.section_title("3. Continuous Improvement & Support")
    pdf.body_text(
        "This system was developed by Daniel Clement Masubi for Platinum Credit Limited (PCL). "
        "To ensure the platform remains effective and continuously improving, ongoing support "
        "and enhancements are provided to keep the system aligned with business needs."
    )
    pdf.body_text(
        "Coverage includes continuous improvement, bug fixes, new features, integrations, and "
        "technical support. The system evolves with the business \u2014 incorporating new reports, "
        "data sources, and KPIs as the company\u2019s reporting requirements grow."
    )
    pdf.ln(2)

    # ═══════════════════════════════════════════════════════════════
    # PAGE 3 — DEPARTMENTAL FEATURES (the core value)
    # ═══════════════════════════════════════════════════════════════
    pdf.add_page()

    pdf.section_title("4. Departmental Dashboard \u2014 Core Features")
    pdf.body_text(
        "The Departmental Dashboard is the most powerful section, featuring nine fully operational "
        "tabs. These features automate what previously required hours of manual Excel and "
        "PowerPoint work."
    )

    # Score Card
    pdf.sub_title("4.1  Score Card Reports")
    pdf.body_text(
        "Generates a unified HOD Score Card across management, CRM, call center, and MTD data. "
        "Two modes: Weekly (Mon\u2013Sat daily columns) and Monthly (aggregated). Six sections: "
        "Management Summary, Sales & Compliance, Leads & Marketing, Product Sales (MTD), "
        "Call Center Performance, and Production Sales. Download as multi-sheet Excel or email "
        "directly with the Excel attachment."
    )

    # Sales Review
    pdf.sub_title("4.2  Sales Review Report")
    pdf.body_text(
        "A formal monthly sales review presented as printable pages with charts and analysis. Covers "
        "general trends, performance comparisons, new vs repeat business, per-product contribution, "
        "and detailed product blocks (CS Mainland, CS Zanzibar, LBF, SME, Agrifinance). "
        "Download as a branded PowerPoint presentation (.pptx) or email it directly."
    )

    # Gap Analysis
    pdf.sub_title("4.3  Gap Analysis Reports")
    pdf.body_text(
        "Transforms MTD data into gap-to-target views by Team Leader (branch) and RSM (supervision). "
        "Calculates targets, achieved, remaining gap, % achieved, grade (A\u2013E), and comment band. "
        "Supports CS, LBF, and SME. Key capabilities:"
    )
    gap_items = [
        "Edit and save Actual Sales Reps directly in the system",
        "Upload Excel template with TL/RSM names, emails, and actual reps",
        "Email managers with full Gap Analysis Excel (Branch + RSM sheets)",
        "Email individual Team Leaders with personalized performance data",
        "Email RSMs with personalized summaries and attachments",
        "Copy/paste recipient emails (clipboard or paste box)",
    ]
    for g in gap_items:
        pdf.bullet(g)
    pdf.ln(2)

    # KPI Analysis
    pdf.sub_title("4.4  KPI Analysis Report (CS)")
    pdf.body_text(
        "Tracks CS performance against defined KPI standards. Supports Total (nationwide, 6 KPIs) "
        "and per-cluster views (Cluster 1, 2, 3, Zanzibar \u2014 8 KPIs each). Color-coded rows: "
        "violet (100%+), blue (75%+), green (50%+), yellow (25%+), orange (10%+), red (<10%)."
    )

    kpi_w = [8, 62, 112]
    pdf.set_font("Helvetica", "B", 7)
    pdf.set_text_color(*PRIMARY_MID)
    pdf.cell(0, 5, "Total KPI (6 nationwide standards):", new_x="LMARGIN", new_y="NEXT")
    total_kpis = [
        ("1", "Sales Target Achievement", "Mainland + Zanzibar + Call Center target vs achieved"),
        ("2", "Branch Sales Achievement", "85% of branches at 100% target"),
        ("3", "New Business Targets", "Mainland 65% / Zanzibar 70% new business"),
        ("4", "Portfolio Growth & PAR 30", "Portfolio growth and PAR >30 below 5%"),
        ("5", "Active Client Growth", "20% annualized growth; regions & clusters hit target"),
        ("6", "CRM Usage & Data Consent", "90% CRM usage; 65% data consent"),
    ]
    pdf.table_header(["#", "KPI", "Description"], kpi_w)
    for i, (n, k, d) in enumerate(total_kpis):
        pdf.table_row([n, k, d], kpi_w, fill=(i % 2 == 0))
    pdf.ln(2)

    pdf.set_font("Helvetica", "B", 7)
    pdf.set_text_color(*PRIMARY_MID)
    pdf.cell(0, 5, "Cluster KPI (8 standards per cluster):", new_x="LMARGIN", new_y="NEXT")
    cluster_kpis = [
        ("1", "100% cluster sales target", "Cluster target vs disbursement"),
        ("2", "Regions hit new biz at 100%", "Regions: new business target vs achieved"),
        ("3", "90% branches on sales target", "Branches in cluster at 100% target"),
        ("4", "85% recruitment", "Recruitment target vs achieved by region"),
        ("5", "20% portfolio growth annually", "Cluster portfolio growth, annualized"),
        ("6", "PAR 30 under 5%", "PAR >30 for this cluster"),
        ("7", "On location completion 95%", "CRM: completed vs at location"),
        ("8", "Data consent 80%", "CRM: data consent % for cluster"),
    ]
    pdf.table_header(["#", "KPI", "Description"], kpi_w)
    for i, (n, k, d) in enumerate(cluster_kpis):
        pdf.table_row([n, k, d], kpi_w, fill=(i % 2 == 0))
    pdf.ln(2)

    pdf.body_text(
        "Cluster email attaches two files: the Cluster KPI Target file and the Cluster KPI Analysis "
                "workbook. Total email attaches the single KPI report workbook."
    )

    # Social Media Analysis
    pdf.sub_title("4.5  Social Media Analysis")
    pdf.body_text(
        "Analyzes social media engagement and performance metrics across platforms. Tracks "
        "lead generation from social channels, post performance, audience growth, and "
        "conversion metrics. Provides actionable insights for marketing strategy optimization."
    )

    # Settlements Analysis
    pdf.sub_title("4.6  Settlements Analysis")
    pdf.body_text(
        "Monitors and analyzes settlement performance across departments and branches. "
        "Tracks settlement rates, aging, reconciliation status, and outstanding items. "
        "Provides branch-level and department-level settlement overviews with trend analysis."
    )

    # Temporary Reports
    pdf.sub_title("4.7  Temporary Reports")
    pdf.body_text(
        "A flexible reporting module for ad-hoc analysis needs. Supports quick generation "
        "of custom reports on demand, allowing users to pull specific data slices without "
        "waiting for formal report cycles. Ideal for time-sensitive business queries."
    )

    # Marketing Analysis
    pdf.sub_title("4.8  Marketing Analysis")
    pdf.body_text(
        "Provides comprehensive marketing performance analytics including campaign ROI, "
        "lead conversion funnels, channel effectiveness comparisons, and budget utilization "
        "tracking. Helps optimize marketing spend and identify high-performing initiatives."
    )

    # RSM Score Card
    pdf.sub_title("4.9  RSM Score Card")
    pdf.body_text(
        "Extends score card functionality to the Regional Sales Manager level. Tracks RSM "
        "performance across management, sales, compliance, and team development metrics. "
        "Provides regional performance comparisons and identifies coaching opportunities."
    )
    pdf.ln(2)

    # ═══════════════════════════════════════════════════════════════
    # PAGE 4 — EMAIL, EXPORTS, DATA FLOW, ROLES
    # ═══════════════════════════════════════════════════════════════
    pdf.add_page()

    pdf.section_title("5. Email & Export Capabilities")
    pdf.body_text(
        "The system sends professional HTML emails with attachments directly from the dashboard. "
        "No need to open a separate email client."
    )
    email_w = [38, 60, 84]
    pdf.table_header(["Report", "Format", "Attachments"], email_w)
    emails = [
        ("Score Card", "Excel (.xlsx)", "Multi-sheet workbook"),
        ("Sales Review", "PowerPoint (.pptx)", "Branded presentation"),
        ("Gap Analysis", "Excel (.xlsx)", "Full or per-TL/RSM slices"),
        ("KPI (Total)", "Excel (.xlsx)", "KPI report workbook"),
        ("KPI (Cluster)", "Excel (.xlsx)", "Target file + KPI workbook (2 files)"),
        ("Social Media", "Excel (.xlsx)", "Engagement and conversion data"),
        ("Settlements", "Excel (.xlsx)", "Settlement analysis workbook"),
        ("Marketing", "Excel (.xlsx)", "Campaign and ROI report"),
        ("RSM Score Card", "Excel (.xlsx)", "RSM performance workbook"),
    ]
    for i, (r, f, a) in enumerate(emails):
        pdf.table_row([r, f, a], email_w, fill=(i % 2 == 0))
    pdf.ln(3)

    pdf.section_title("6. Data Flow")
    pdf.body_text(
        "Data moves through five simple steps:"
    )
    steps = [
        ("UPLOAD", "Users upload Excel reports (Management, CRM, Call Center, MTD) via department pages."),
        ("STORE", "The backend server receives the file, stores it securely, and records metadata."),
        ("PARSE", "When a dashboard opens, the system reads the Excel, runs calculations automatically."),
        ("VISUALIZE", "Results appear as interactive charts, color-coded tables, and summary cards."),
        ("EXPORT", "Users download reports (Excel, PowerPoint) or email them with one click."),
    ]
    for i, (step, desc) in enumerate(steps):
        pdf.set_font("Helvetica", "B", 8.5)
        pdf.set_text_color(*PRIMARY_MID)
        pdf.cell(6, 5, f"{i+1}.")
        pdf.set_fill_color(*PRIMARY)
        pdf.set_text_color(*WHITE)
        pdf.set_font("Helvetica", "B", 7.5)
        w_badge = pdf.get_string_width(step) + 6
        pdf.cell(w_badge, 5, step, fill=True, align="C")
        pdf.cell(3)
        pdf.set_font("Helvetica", "", 8.5)
        pdf.set_text_color(*DARK_TEXT)
        pdf.cell(0, 5, desc, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    pdf.section_title("7. User Roles & Security")
    role_w = [22, 160]
    pdf.table_header(["Role", "Access"], role_w)
    roles = [
        ("Admin", "Full access: all departments, all reports, Administration panel"),
        ("ALL", "All departments and reports (no user management)"),
        ("CS", "Dashboard + CS Reports only"),
        ("LBF", "Dashboard + LBF Reports only"),
        ("SME", "Dashboard + SME Reports only"),
    ]
    for i, (r, a) in enumerate(roles):
        pdf.table_row([r, a], role_w, fill=(i % 2 == 0))
    pdf.ln(2)
    pdf.body_text(
        "Security features include JWT authentication (24-hour tokens), encrypted passwords, "
        "role-based access control, CORS protection, and file validation on upload."
    )

    pdf.section_title("8. Additional Features")
    extras = [
        "Dark Mode / Light Mode \u2014 toggle at any time; preference saved automatically",
        "Administration Panel \u2014 User Management, Report Management, Challenge Management",
        "Department Pages \u2014 CS, LBF, SME report upload, viewing, and download",
        "Challenge Management \u2014 create motivational challenges for staff (contests, targets)",
        "Profile Management \u2014 update personal details and password",
    ]
    for e in extras:
        pdf.bullet(e)
    pdf.ln(3)

    # ═══════════════════════════════════════════════════════════════
    # PAGE 5 — VALUE PROPOSITION + CONCLUSION
    # ═══════════════════════════════════════════════════════════════
    pdf.add_page()

    pdf.section_title("9. Value Proposition")
    pdf.body_text("Why this system matters to PCL:")

    val_w = [91, 91]
    pdf.table_header(["Before (Manual Process)", "After (PCL Analysis System)"], val_w)
    comparisons = [
        ("Reports take hours/days to prepare", "Reports generated instantly"),
        ("Inconsistent calculations across people", "One engine, consistent results every time"),
        ("Reports scattered across emails & folders", "All reports in one place, any browser"),
        ("Sharing requires manual email + attachments", "One-click email with professional formatting"),
        ("No real-time performance overview", "Executive dashboard available at a glance"),
        ("KPI tracking on separate spreadsheets", "Automated KPI with color-coded indicators"),
        ("Gap analysis calculated manually per TL", "Automatic grading with personalized emails"),
        ("Sales reviews need manual PowerPoint", "Auto-generated PowerPoint with charts"),
    ]
    for i, (b, a) in enumerate(comparisons):
        pdf.table_row([b, a], val_w, fill=(i % 2 == 0))
    pdf.ln(4)

    pdf.section_title("10. Technology & Infrastructure")
    pdf.body_text(
        "Built with modern, enterprise-grade technology: React 18 + Vite (frontend), "
        "Go / Gin (backend API), PostgreSQL 16 (database), Redis 7 (caching), Docker + Nginx "
        "(deployment). Excel processing via SheetJS, PowerPoint via PptxGenJS, charts via "
        "Recharts + D3.js. Email via Gmail SMTP. The entire system starts with a single command."
    )

    pdf.section_title("11. Implementation Alignment & On-Site Training")
    pdf.body_text(
        "To ensure successful rollout and long-term adoption, implementation should include an "
        "on-site working session at each subsidiary. For each visit, I will stay with the Data "
        "Analyst Team for one week to:"
    )
    implementation_items = [
        "Understand each subsidiary's full reporting workflow and operational needs",
        "Align system requirements clearly with local reporting expectations",
        "Confirm report definitions, KPI logic, and dashboard outputs with the team",
        "Provide practical, hands-on training for analysts and key users",
        "Establish clear usage standards and support expectations after go-live",
    ]
    for item in implementation_items:
        pdf.bullet(item)
    pdf.ln(2)

    # conclusion box
    pdf.ln(2)
    pdf.set_fill_color(*PRIMARY)
    pdf.rect(pdf.l_margin, pdf.get_y(), 182, 52, "F")
    y_box = pdf.get_y() + 5
    pdf.set_xy(pdf.l_margin + 8, y_box)
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(*WHITE)
    pdf.cell(166, 7, "Conclusion", align="L", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(pdf.l_margin + 8)
    pdf.set_font("Helvetica", "", 8.5)
    pdf.set_text_color(210, 220, 240)
    pdf.multi_cell(166, 4.3, safe(
        "The PCL Analysis System is a purpose-built analytical platform developed by Daniel Clement "
        "Masubi (Senior Data Analyst & Sales Support) for PCL. The system is designed for continuous "
        "improvement, with new features, integrations, and support to keep the platform aligned with "
        "business needs. Combined with structured on-site alignment and training for each subsidiary, "
        "this solution delivers greater accuracy, faster turnaround, and deeper insights across the "
        "organization."
    ))
    pdf.ln(6)

    # signature line
    pdf.set_text_color(*MID_GRAY)
    pdf.set_font("Helvetica", "I", 7.5)
    pdf.cell(0, 4, "Prepared by Daniel Clement Masubi  |  February 2026  |  Confidential",
             align="C")

    # ── save ────────────────────────────────────────────────────────
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "PCL_Analysis_System_Document.pdf")
    pdf.output(out_path)
    print(f"\n  PDF generated successfully: {out_path}\n")
    print(f"  Pages: {pdf.page_no() - 1} (cover + {pdf.page_no() - 2} content pages)\n")


if __name__ == "__main__":
    build_pdf()
