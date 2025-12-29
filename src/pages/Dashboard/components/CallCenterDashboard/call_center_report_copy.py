import pandas as pd
import matplotlib.pyplot as plt
from datetime import datetime
import os
import re

from dotenv import load_dotenv

# =============================================================================
# STEP 1: CONFIGURATION AND FILE PATHS
# =============================================================================

# Define file paths
folder_path = r"C:\Users\Daniel\Desktop\code\pcl\CALL_CENTER\ROW_FILES"
export_root = r"C:\Users\Daniel\Desktop\code\pcl\CALL_CENTER\NEW_FILES"

# Classify files
cdr_file = None
master_cdr_file = None

# Get list of files in the folder
files = os.listdir(folder_path)
for file in files:
    full_path = os.path.join(folder_path, file)
    name = file.lower()
    if name.startswith("pse-cdr"):
        cdr_file = full_path
    elif name.startswith("master_cdr_call"):
        master_cdr_file = full_path

print(f"📁 CDR File: {cdr_file}")
print(f"📁 Master CDR File: {master_cdr_file}")

# =============================================================================
# STEP 2: LOAD DATA AND EXTRACT REPORT DATE
# =============================================================================

print("📊 Loading call data...")
df = pd.read_csv(cdr_file)

# Extract report date from the 'Time' column
def extract_report_date(time_series):
    """
    Extract the report date from the Time column.
    Assumes format: '11/27/2025 06:19:41 AM'
    """
    if len(time_series) == 0 or pd.isna(time_series.iloc[0]):
        # Fallback to yesterday's date if no valid time data
        return (datetime.now() - pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    
    first_time = str(time_series.iloc[0])
    date_part = first_time.split(' ')[0]  # Get '11/27/2025'
    
    # Convert to standard format
    try:
        date_obj = datetime.strptime(date_part, "%m/%d/%Y")
        return date_obj.strftime("%Y-%m-%d")
    except ValueError:
        # Fallback if parsing fails
        return (datetime.now() - pd.Timedelta(days=1)).strftime("%Y-%m-%d")

report_date = extract_report_date(df['Time'])
print(f"📅 Report date extracted from file: {report_date}")

# Generate Excel output path automatically
row_excel_file = f"INITIAL_CDR_CALL_REPORT_{report_date}.xlsx"
excel_path = os.path.join(folder_path, row_excel_file)

# Save to Excel
df.to_excel(excel_path, index=False)
print(f"💾 Converted to: {excel_path}")

# Create output directory using the extracted date
output_dir = os.path.join(export_root, report_date)
os.makedirs(output_dir, exist_ok=True)
print(f"📁 Output directory created: {output_dir}")

# =============================================================================
# STEP 3: DATA CLEANING AND PREPROCESSING
# =============================================================================

print("🧹 Cleaning data...")

# Drop unnecessary columns
drop_cols = ['DID', 'DOD', 'Caller IP Address', 'PIN Code', 'Recording File', 'Reason']
df.drop(columns=[col for col in drop_cols if col in df.columns], inplace=True)

# Function to unify agent name
def extract_clean_name(name):
    """
    Clean and standardize agent names by removing prefixes and correcting names.
    """
    if pd.isna(name):
        return name
    name = re.sub(r'^Voicemail\s+', '', name)
    name = re.sub(r'<.*?>', '', name)
    name = name.strip()
    if name == 'Khadija Mohamed':
        return 'Hadija Mohamed'
    return name

# Clean 'Call From' and 'Call To' columns
df['Call From'] = df['Call From'].apply(extract_clean_name)
df['Call To'] = df['Call To'].apply(extract_clean_name)

# Agents to exclude from analysis
excluded_agents = ['Ikrah Ally', 'David Kileo', 'Aziza Mfanga', 'Madina Mohamed', 
                   'Jackson Swai', 'Thomas Francis', 'Conference Call']

# =============================================================================
# STEP 4: CALL SUCCESS CLASSIFICATION
# =============================================================================

print("✅ Classifying call success...")

def determine_success(row):
    """
    Determine if a call was successful based on status and talk duration.
    """
    status = str(row['Status']).lower()
    if status in ['no answer', 'busy', 'failed', 'voicemail']:
        return 'Unsuccessful'
    elif status == 'answered':
        try:
            talk_duration = int(row['Talk Duration'])
            return 'Successful' if talk_duration >= 5 else 'Unsuccessful'
        except:
            return 'Unsuccessful'
    else:
        return 'Unsuccessful'

df['Successful ?'] = df.apply(determine_success, axis=1)

# =============================================================================
# STEP 5: CALL NOTES PROCESSING
# =============================================================================

print("📝 Processing call notes...")

def clean_notes(row):
    """
    Clean and categorize call notes based on call status.
    """
    note = str(row['Call Notes'])
    if note.strip() == '' or note.lower() == 'nan':
        status = str(row['Status']).lower()
        if status in ['no answer', 'voicemail']:
            return 'Not picking'
        elif status == 'failed':
            return 'Failed Connection'
        elif status == 'busy':
            return 'Busy'
        elif status == 'answered':
            return 'NO COMMENT WRITTEN'
        else:
            return 'UNKNOWN'
    else:
        parts = note.lower().split('remark')
        return note[:len(parts[0])].strip()

df['Call Notes'] = df.apply(clean_notes, axis=1)

# =============================================================================
# STEP 6: CALCULATE KEY METRICS
# =============================================================================

print("📈 Calculating metrics...")

# General metrics
total_calls = len(df)
communication_counts = df['Communication Type'].value_counts()
successful_calls = df[df['Successful ?'] == 'Successful']
unsuccessful_calls = df[df['Successful ?'] == 'Unsuccessful']
note_counts = df['Call Notes'].value_counts()
distinct_called_numbers = df[df['Communication Type'] == 'Outbound']['Call To'].nunique()
distinct_calling_numbers = df[df['Communication Type'] == 'Inbound']['Call From'].nunique()

# Dropped calls analysis
dropped_calls = df[df['Call Notes'] == 'Dead Air']
dropped_total = len(dropped_calls)
dropped_pct = (dropped_total / total_calls) if total_calls else 0

# Callback analysis
dropped_inbound = dropped_calls[dropped_calls['Communication Type'] == 'Inbound']
inbound_call_to_values = df[df['Communication Type'] == 'Inbound']['Call To'].unique()
inbound_called_back = dropped_inbound[dropped_inbound['Call From'].isin(inbound_call_to_values)]

dropped_outbound = dropped_calls[dropped_calls['Communication Type'] == 'Outbound']
outbound_call_to_counts = df[df['Communication Type'] == 'Outbound']['Call To'].value_counts()
repeated_outbound_numbers = outbound_call_to_counts[outbound_call_to_counts > 1].index
outbound_called_back = dropped_outbound[dropped_outbound['Call To'].isin(repeated_outbound_numbers)]

called_back_total = len(inbound_called_back) + len(outbound_called_back)
called_back_pct = (called_back_total / dropped_total) if dropped_total else 0

# =============================================================================
# STEP 7: OUTBOUND CALLS ANALYSIS
# =============================================================================

print("📤 Analyzing outbound calls...")

outbound = df[df['Communication Type'] == 'Outbound']
outbound = outbound[~outbound['Call From'].isin(excluded_agents)]
outbound_agents = outbound['Call From'].nunique()
avg_outbound_calls = round(len(outbound) / outbound_agents, 2) if outbound_agents else 0
outbound_successful = outbound[outbound['Successful ?'] == 'Successful']
outbound_unsuccessful = outbound[outbound['Successful ?'] == 'Unsuccessful']

# =============================================================================
# STEP 8: INBOUND CALLS ANALYSIS
# =============================================================================

print("📥 Analyzing inbound calls...")

inbound = df[df['Communication Type'] == 'Inbound']
inbound = inbound[~inbound['Call To'].isin(excluded_agents)]
inbound_total = len(inbound)
inbound_agents = inbound['Call To'].nunique()
inbound_successful = inbound[inbound['Successful ?'] == 'Successful']
inbound_unsuccessful = inbound[inbound['Successful ?'] == 'Unsuccessful']
inbound_successful_pct = (len(inbound_successful) / inbound_total) if inbound_total else 0
inbound_unsuccessful_pct = (len(inbound_unsuccessful) / inbound_total) if inbound_total else 0
avg_inbound_calls = round(inbound_total / inbound_agents, 2) if inbound_agents else 0

# Called back metric for inbound
outbound_numbers = outbound['Call To'].unique()
called_back = inbound_unsuccessful[inbound_unsuccessful['Call From'].isin(outbound_numbers)]
called_back_pct_inbound = (len(called_back) / len(inbound_unsuccessful)) if len(inbound_unsuccessful) else 0

# =============================================================================
# STEP 9: AGENT PERFORMANCE ANALYSIS
# =============================================================================

print("👥 Analyzing agent performance...")

# Create agent performance dataframes
inbound_agents_df = inbound.groupby('Call To').agg(
    inbound_calls=('Call To', 'count'),
    successful_inbound=('Successful ?', lambda x: (x == 'Successful').sum())
)

outbound_agents_df = outbound.groupby('Call From').agg(
    outbound_calls=('Call From', 'count'),
    successful_outbound=('Successful ?', lambda x: (x == 'Successful').sum())
)

# Merge and clean agent data
combined_agents_df = pd.merge(outbound_agents_df, inbound_agents_df, 
                             left_index=True, right_index=True, how='outer').fillna(0)
combined_agents_df.index.name = 'Agent Name'
combined_agents_df = combined_agents_df.reset_index()
combined_agents_df['Agent Name'] = combined_agents_df['Agent Name'].replace('Khadija Mohamed', 'Hadija Mohamed')
combined_agents_df = combined_agents_df[~combined_agents_df['Agent Name'].isin(excluded_agents + ['Barnabas Ngassa'])]
combined_agents_df = combined_agents_df.groupby('Agent Name', as_index=False).sum()

# Calculate additional metrics
combined_agents_df['Total Calls'] = combined_agents_df['outbound_calls'] + combined_agents_df['inbound_calls']
combined_agents_df['Successful Calls'] = combined_agents_df['successful_outbound'] + combined_agents_df['successful_inbound']
# For combined_agents_df - keep as percentage but format with % sign
combined_agents_df['Success Rate (%)'] = (combined_agents_df['Successful Calls'] / combined_agents_df['Total Calls'] * 100)
combined_agents_df['Success Rate (%)'] = combined_agents_df['Success Rate (%)'].apply(lambda x: f"{x:.2f}%")

# Final column selection and sorting
combined_agents_df = combined_agents_df[['Agent Name', 'outbound_calls', 'inbound_calls', 
                                        'Total Calls', 'Successful Calls', 'Success Rate (%)']]
combined_agents_df = combined_agents_df.sort_values(by='Successful Calls', ascending=False)

# =============================================================================
# STEP 10: SEPARATE AGENTS BY PRODUCT (LBF AND CS)
# =============================================================================

print("🏷️ Separating agents by product...")

# Load master file to get product information
if master_cdr_file and os.path.exists(master_cdr_file):
    try:
        master_df = pd.read_excel(master_cdr_file, sheet_name='Agent_Performance')
        
        # Create lookup dictionary for agent products
        product_lookup = {}
        if 'Agent Name' in master_df.columns and 'Product' in master_df.columns:
            for _, row in master_df.iterrows():
                agent_name = row['Agent Name']
                product = row['Product']
                if pd.notna(agent_name) and pd.notna(product):
                    product_lookup[agent_name] = product
        
        # Map products to agents in combined_agents_df
        combined_agents_df['Product'] = combined_agents_df['Agent Name'].map(product_lookup)
        combined_agents_df['Product'] = combined_agents_df['Product'].fillna('ERR')
        
        print(f"✅ Product mapping completed. Distribution:")
        print(combined_agents_df['Product'].value_counts())
        
    except Exception as e:
        print(f"⚠️ Error loading master file: {e}")
        combined_agents_df['Product'] = 'ERR'
else:
    print("⚠️ Master CDR file not found. All agents will be marked as 'ERR'")
    combined_agents_df['Product'] = 'ERR'

# Separate agents by product
lbf_agents = combined_agents_df[combined_agents_df['Product'] == 'LBF']
cs_agents = combined_agents_df[combined_agents_df['Product'] == 'CS']
err_agents = combined_agents_df[combined_agents_df['Product'] == 'ERR']

print(f"📊 LBF Agents: {len(lbf_agents)}")
print(f"📊 CS Agents: {len(cs_agents)}")
print(f"📊 ERR Agents: {len(err_agents)}")

# Create product-specific directories
lbf_dir = os.path.join(export_root, 'LBF', report_date)
cs_dir = os.path.join(export_root, 'CS', report_date)
err_dir = os.path.join(export_root, 'ERR', report_date)

os.makedirs(lbf_dir, exist_ok=True)
os.makedirs(cs_dir, exist_ok=True)
os.makedirs(err_dir, exist_ok=True)

# =============================================================================
# STEP 11: CREATE BEAUTIFUL VISUALIZATIONS FOR ALL PRODUCTS
# =============================================================================

print("📊 Creating beautiful visualizations...")

# Define stunning color palette (red to violet spectrum)
colors = ['#FF6B6B', '#FF8E53', '#FFB142', '#FFD166', '#06D6A0', '#118AB2', '#6A4C93']

def create_stunning_chart(data, title, product_name, chart_type='barh'):
    """Create beautiful charts with stunning colors and styling"""
    plt.figure(figsize=(12, 8))
    
    # Create gradient background
    ax = plt.gca()
    ax.set_facecolor('#f8f9fa')
    
    if chart_type == 'barh':
        bars = plt.barh(range(len(data)), data.values, color=colors[:len(data)], 
                       alpha=0.8, edgecolor='white', linewidth=2)
        
        # Add data labels on bars
        for i, (bar, value) in enumerate(zip(bars, data.values)):
            plt.text(bar.get_width() + bar.get_width() * 0.01, bar.get_y() + bar.get_height()/2,
                    f'{value}', ha='left', va='center', fontsize=10, fontweight='bold', color='#2d3436')
        
        plt.yticks(range(len(data)), data.index, fontsize=11)
        plt.xlabel('Number of Calls', fontsize=12, fontweight='bold', color='#2d3436')
        
    else:
        bars = plt.bar(range(len(data)), data.values, color=colors[:len(data)], 
                      alpha=0.8, edgecolor='white', linewidth=2)
        
        # Add data labels on bars
        for bar, value in zip(bars, data.values):
            plt.text(bar.get_x() + bar.get_width()/2, bar.get_height() + bar.get_height() * 0.01,
                    f'{value}', ha='center', va='bottom', fontsize=10, fontweight='bold', color='#2d3436')
        
        plt.xticks(range(len(data)), data.index, rotation=45, ha='right', fontsize=11)
        plt.ylabel('Number of Calls', fontsize=12, fontweight='bold', color='#2d3436')
    
    # Styling
    plt.title(f'{title} - {product_name} - {report_date}', fontsize=14, fontweight='bold', 
              pad=20, color='#2d3436')
    plt.grid(axis='x' if chart_type == 'barh' else 'y', alpha=0.3, linestyle='--', linewidth=0.5)
    plt.tight_layout()
    
    # Remove spines
    for spine in ax.spines.values():
        spine.set_visible(False)
    
    return plt

def get_product_data(agents_df):
    """Get filtered data for specific product based on agents"""
    if len(agents_df) == 0:
        return None
    
    # Get agent names for this product
    product_agent_names = agents_df['Agent Name'].tolist()
    
    # Filter main data for these agents
    product_df = df[
        (df['Call From'].isin(product_agent_names)) | 
        (df['Call To'].isin(product_agent_names))
    ].copy()
    
    return product_df

# Create call notes distribution chart for main report (all products)
create_stunning_chart(note_counts, 'Call Notes Distribution', 'All Products', 'barh')
chart_path = os.path.join(output_dir, f"call_notes_distribution_{report_date}.png")
plt.savefig(chart_path, dpi=300, bbox_inches='tight', facecolor='#f8f9fa')
plt.close()

# Create charts for each product with PRODUCT-SPECIFIC DATA
def create_product_charts(agents_df, product_name, product_dir):
    """Create beautiful charts for each product with product-specific data"""
    if len(agents_df) == 0:
        print(f"⚠️ No agents found for {product_name}, skipping charts")
        return
    
    # Get product-specific data
    product_df = get_product_data(agents_df)
    if product_df is None or len(product_df) == 0:
        print(f"⚠️ No data found for {product_name} agents, skipping charts")
        return
    
    # Call Notes Distribution for product
    product_note_counts = product_df['Call Notes'].value_counts()
    if len(product_note_counts) > 0:
        create_stunning_chart(product_note_counts, 'Call Notes Distribution', product_name, 'barh')
        chart_path = os.path.join(product_dir, f"call_notes_distribution_{product_name}_{report_date}.png")
        plt.savefig(chart_path, dpi=300, bbox_inches='tight', facecolor='#f8f9fa')
        plt.close()
        print(f"📊 Created call notes chart for {product_name}: {len(product_note_counts)} categories")
    
    # Communication Type Distribution for product
    product_comm_counts = product_df['Communication Type'].value_counts()
    if len(product_comm_counts) > 0:
        create_stunning_chart(product_comm_counts, 'Communication Type Distribution', product_name, 'bar')
        chart_path = os.path.join(product_dir, f"communication_type_{product_name}_{report_date}.png")
        plt.savefig(chart_path, dpi=300, bbox_inches='tight', facecolor='#f8f9fa')
        plt.close()
        print(f"📊 Created communication type chart for {product_name}")
    
    # Success Rate Distribution for product
    product_success_counts = product_df['Successful ?'].value_counts()
    if len(product_success_counts) > 0:
        create_stunning_chart(product_success_counts, 'Call Success Distribution', product_name, 'bar')
        chart_path = os.path.join(product_dir, f"success_distribution_{product_name}_{report_date}.png")
        plt.savefig(chart_path, dpi=300, bbox_inches='tight', facecolor='#f8f9fa')
        plt.close()
        print(f"📊 Created success distribution chart for {product_name}")
    
    # Agent Performance Chart (Top 10 agents by successful calls)
    top_agents = agents_df.nlargest(10, 'Successful Calls')
    if len(top_agents) > 0:
        agent_performance = top_agents.set_index('Agent Name')['Successful Calls']
        create_stunning_chart(agent_performance, 'Top Agents by Successful Calls', product_name, 'bar')
        chart_path = os.path.join(product_dir, f"top_agents_{product_name}_{report_date}.png")
        plt.savefig(chart_path, dpi=300, bbox_inches='tight', facecolor='#f8f9fa')
        plt.close()
        print(f"📊 Created top agents chart for {product_name}: {len(top_agents)} agents")
    
    # Status Distribution for product
    product_status_counts = product_df['Status'].value_counts()
    if len(product_status_counts) > 0:
        create_stunning_chart(product_status_counts, 'Call Status Distribution', product_name, 'barh')
        chart_path = os.path.join(product_dir, f"status_distribution_{product_name}_{report_date}.png")
        plt.savefig(chart_path, dpi=300, bbox_inches='tight', facecolor='#f8f9fa')
        plt.close()
        print(f"📊 Created status distribution chart for {product_name}")

# Create charts for each product with THEIR OWN DATA
print("📈 Creating LBF-specific charts...")
create_product_charts(lbf_agents, 'LBF', lbf_dir)

print("📈 Creating CS-specific charts...")
create_product_charts(cs_agents, 'CS', cs_dir)

print("📈 Creating ERR-specific charts...")
create_product_charts(err_agents, 'ERR', err_dir)

# Create agent summary table as image for each product (keeping the original table format)
def create_agent_table_image(agents_df, product_name, save_dir):
    """Create agent performance table image for specific product"""
    if len(agents_df) > 0:
        fig, ax = plt.subplots(figsize=(12, max(3, len(agents_df)*0.4)))
        ax.axis('off')
        ax.set_title(f"Agent Call Performance Summary - {product_name} - {report_date}", 
                    fontsize=16, fontweight='bold', pad=20, color='#2d3436')
        
        # Create table with better styling
        table = ax.table(cellText=agents_df.values,
                         colLabels=agents_df.columns.tolist(),
                         cellLoc='center', loc='center',
                         colColours=["#1F1BEF"] * len(agents_df.columns))  # Header color
        
        table.auto_set_font_size(False)
        table.set_fontsize(10)
        table.auto_set_column_width(col=list(range(len(agents_df.columns))))
        
        # Style the table
        for (i, j), cell in table.get_celld().items():
            if i == 0:  # Header row
                cell.set_text_props(weight='bold', color='white')
                cell.set_facecolor("#0B1EEF")
            else:
                cell.set_facecolor('#f8f9fa' if i % 2 == 0 else '#e9ecef')
        
        plt.tight_layout()
        img_path = os.path.join(save_dir, f"agent_call_summary_{product_name}_{report_date}.png")
        plt.savefig(img_path, dpi=300, bbox_inches='tight', facecolor='#f8f9fa')
        plt.close()
        print(f"📋 Created agent table for {product_name}: {len(agents_df)} agents")
        return img_path
    return None

# Create tables for each product group
print("📋 Creating agent performance tables...")
create_agent_table_image(lbf_agents, 'LBF', lbf_dir)
create_agent_table_image(cs_agents, 'CS', cs_dir)
create_agent_table_image(err_agents, 'ERR', err_dir)

# =============================================================================
# STEP 12: EXPORT TO EXCEL FILES BY PRODUCT
# =============================================================================

print("💾 Exporting to Excel files by product...")

def generate_product_text_report(agents_df, product_df, product_name, product_dir, total_calls, success_rate):
    """Generate text report for specific product"""
    
    # Calculate product-specific metrics
    product_communication_counts = product_df['Communication Type'].value_counts()
    product_successful_calls = len(product_df[product_df['Successful ?'] == 'Successful'])
    product_unsuccessful_calls = len(product_df[product_df['Successful ?'] == 'Unsuccessful'])
    product_note_counts = product_df['Call Notes'].value_counts()
    
    product_outbound = product_df[product_df['Communication Type'] == 'Outbound']
    product_outbound = product_outbound[~product_outbound['Call From'].isin(excluded_agents)]
    
    product_inbound = product_df[product_df['Communication Type'] == 'Inbound']
    product_inbound = product_inbound[~product_inbound['Call To'].isin(excluded_agents)]
    
    # Unique numbers
    distinct_called_numbers = product_df[product_df['Communication Type'] == 'Outbound']['Call To'].nunique()
    distinct_calling_numbers = product_df[product_df['Communication Type'] == 'Inbound']['Call From'].nunique()
    
    # Outbound metrics
    outbound_agents_count = product_outbound['Call From'].nunique()
    avg_outbound_calls = round(len(product_outbound) / outbound_agents_count, 2) if outbound_agents_count else 0
    outbound_successful = product_outbound[product_outbound['Successful ?'] == 'Successful']
    outbound_unsuccessful = product_outbound[product_outbound['Successful ?'] == 'Unsuccessful']
    
    # Inbound metrics - FIXED: Keep as DataFrames, not counts
    inbound_total = len(product_inbound)
    inbound_successful_df = product_inbound[product_inbound['Successful ?'] == 'Successful']  # Keep as DataFrame
    inbound_unsuccessful_df = product_inbound[product_inbound['Successful ?'] == 'Unsuccessful']  # Keep as DataFrame
    inbound_successful_count = len(inbound_successful_df)
    inbound_unsuccessful_count = len(inbound_unsuccessful_df)
    inbound_successful_pct = (inbound_successful_count / inbound_total) if inbound_total else 0
    inbound_unsuccessful_pct = (inbound_unsuccessful_count / inbound_total) if inbound_total else 0
    avg_inbound_calls = round(inbound_total / product_inbound['Call To'].nunique(), 2) if len(product_inbound) > 0 else 0
    
    # Called back metric for inbound - FIXED: Use DataFrames instead of counts
    outbound_numbers = product_outbound['Call To'].unique()
    called_back = inbound_unsuccessful_df[inbound_unsuccessful_df['Call From'].isin(outbound_numbers)]
    called_back_pct_inbound = (len(called_back) / inbound_unsuccessful_count) if inbound_unsuccessful_count else 0
    
    # Agent performance
    total_agents = len(agents_df)
    successful_50plus = len(agents_df[agents_df['Successful Calls'] >= 50])
    
    # Generate report
    txt_report_path = os.path.join(product_dir, f"call_center_report_{product_name}_{report_date}.txt")
    
    with open(txt_report_path, 'w', encoding='utf-8') as f:
        f.write(f"Hi,\nBelow is the call center summary report for {report_date}:\n\n")
        f.write("CALLS SUMMARY REPORT\n\n")
        f.write(f"- Total calls made for the day were {total_calls}, with {distinct_called_numbers} unique phone numbers being called (outbound) and {distinct_calling_numbers} unique phone numbers that called in (inbound).\n")
        f.write(f"- Out of the total {total_calls} calls, {product_communication_counts.get('Inbound', 0)} ({product_communication_counts.get('Inbound', 0)/total_calls:.0%}) were inbound calls, ")
        f.write(f"{product_communication_counts.get('Outbound', 0)} ({product_communication_counts.get('Outbound', 0)/total_calls:.0%}) were outbound calls and ")
        f.write(f"{product_communication_counts.get('Internal', 0)} ({product_communication_counts.get('Internal', 0)/total_calls:.0%}) were internal calls.\n")
        f.write(f"- Out of the total {total_calls} calls, {product_successful_calls} ({product_successful_calls/total_calls:.0%}) were successful and {product_unsuccessful_calls} ({product_unsuccessful_calls/total_calls:.0%}) were unsuccessful.\n")
        f.write(f"- Of the total {total_calls} calls made for the day the distribution of the calls disposition is visualized in the chart:\n\n")
        
        f.write("AGENTS PERFORMANCE HIGHLIGHTS\n\n")
        f.write(f"Day Performance Summary : - Of the total {total_agents} agents who made calls, {successful_50plus} ({(successful_50plus/total_agents):.0%}) had 50 or more successful calls for the day (Both inbound & outbound).\n\n")
        
        f.write("For Outbound calls:\n")
        f.write(f"- Average outbound calls made per agent was {avg_outbound_calls}\n")
        f.write(f"- Of the total {outbound_agents_count} agents who made outbound calls, {outbound_successful.groupby('Call From').filter(lambda x: len(x) >= 50)['Call From'].nunique()} ({(outbound_successful.groupby('Call From').filter(lambda x: len(x) >= 50)['Call From'].nunique()/outbound_agents_count):.0%}) Agents had 50 or more successful outbound calls for the day.\n")
        f.write(f"- {outbound_unsuccessful.groupby('Call From').filter(lambda x: len(x) >= 50)['Call From'].nunique()} ({(outbound_unsuccessful.groupby('Call From').filter(lambda x: len(x) >= 50)['Call From'].nunique()/outbound_agents_count):.0%}) Agents had 50 or more unsuccessful outbound calls for the day.\n\n")
        
        if inbound_total:
            f.write("For Inbound Calls:\n")
            f.write(f"- Average inbound calls received per agent was {avg_inbound_calls}\n")
            f.write(f"- Of the total {inbound_total} inbound calls, {inbound_successful_count} ({inbound_successful_pct:.0%}) were successful and {inbound_unsuccessful_count} ({inbound_unsuccessful_pct:.0%}) were unsuccessful.\n")
            f.write(f"- Of the {inbound_unsuccessful_count} unsuccessful inbound calls, {len(called_back)} ({called_back_pct_inbound:.0%}) were called back.\n\n")
        else:
            f.write("No inbound calls recorded for the day.\n\n")
    
    print(f"📄 {product_name} text report generated: {txt_report_path}")

from call_center_email import  integrate_email_automation
def generate_product_report(agents_df, product_name, product_dir):
    """Generate complete report for a specific product"""
    if len(agents_df) == 0:
        print(f"⚠️ No agents found for {product_name}, skipping report generation")
        return
    
    # Get agent names for this product
    product_agent_names = agents_df['Agent Name'].tolist()
    
    # Filter main data for these agents
    product_df = df[
        (df['Call From'].isin(product_agent_names)) | 
        (df['Call To'].isin(product_agent_names))
    ].copy()
    
    # Filter outbound and inbound data
    product_outbound = product_df[product_df['Communication Type'] == 'Outbound']
    product_outbound = product_outbound[~product_outbound['Call From'].isin(excluded_agents)]
    
    product_inbound = product_df[product_df['Communication Type'] == 'Inbound']
    product_inbound = product_inbound[~product_inbound['Call To'].isin(excluded_agents)]
    
    # Calculate product-specific metrics
    product_total_calls = len(product_df)
    product_successful_calls = len(product_df[product_df['Successful ?'] == 'Successful'])
    product_success_rate = (product_successful_calls / product_total_calls) if product_total_calls else 0
    
    # Export main Excel file for product
    excel_file_path = os.path.join(product_dir, f"FINAL_CDR_CALL_REPORT_{product_name}_{report_date}.xlsx")
    
    with pd.ExcelWriter(excel_file_path, engine='openpyxl') as writer:
        # Main cleaned data for product
        product_df.to_excel(writer, sheet_name='All_Call_Data', index=False)
        
        # Agent performance summary
        agents_df.to_excel(writer, sheet_name='Agent_Performance', index=False)
        
        # Outbound calls summary
        if len(product_outbound) > 0:
            outbound_summary = product_outbound.groupby('Call From').agg({
                'Successful ?': ['count', lambda x: (x == 'Successful').sum()]
            }).round(2)
            outbound_summary.columns = ['Total_Outbound', 'Successful_Outbound']
            outbound_summary['Outbound_Success_Rate'] = (outbound_summary['Successful_Outbound'] / outbound_summary['Total_Outbound'] * 100)
            outbound_summary['Outbound_Success_Rate'] = outbound_summary['Outbound_Success_Rate'].apply(lambda x: f"{x:.2f}%")
            outbound_summary.to_excel(writer, sheet_name='Outbound_Summary')
        
        # Inbound calls summary
        if len(product_inbound) > 0:
            inbound_summary = product_inbound.groupby('Call To').agg({
                'Successful ?': ['count', lambda x: (x == 'Successful').sum()]
            }).round(2)
            inbound_summary.columns = ['Total_Inbound', 'Successful_Inbound']
            inbound_summary['Inbound_Success_Rate'] = (inbound_summary['Successful_Inbound'] / inbound_summary['Total_Inbound'] * 100)
            inbound_summary['Inbound_Success_Rate'] = inbound_summary['Inbound_Success_Rate'].apply(lambda x: f"{x:.2f}%")
            inbound_summary.to_excel(writer, sheet_name='Inbound_Summary')
        
        # Call notes summary
        product_note_counts = product_df['Call Notes'].value_counts()
        note_summary = pd.DataFrame(product_note_counts).reset_index()
        note_summary.columns = ['Call_Notes', 'Count']
        note_summary['Percentage'] = note_summary['Count'] / product_total_calls
        note_summary['Percentage'] = note_summary['Percentage'].apply(lambda x: f"{x:.2%}")
        note_summary.to_excel(writer, sheet_name='Call_Notes_Summary', index=False)
    
    # Export agent performance as separate Excel file
    agent_excel_path = os.path.join(product_dir, f"AGENT_PERFORMANCE_{product_name}_{report_date}.xlsx")
    agents_df.to_excel(agent_excel_path, index=False)
  
    # Generate text report for product
    generate_product_text_report(agents_df, product_df, product_name, product_dir, 
                               product_total_calls, product_success_rate)
    
    return excel_file_path

# Generate reports for each product
lbf_excel_path = generate_product_report(lbf_agents, 'LBF', lbf_dir)
cs_excel_path = generate_product_report(cs_agents, 'CS', cs_dir)
err_excel_path = generate_product_report(err_agents, 'ERR', err_dir)



# =============================================================================
# STEP 13: GENERATE MAIN TEXT REPORT (WITH PERCENTAGE FIXES)
# =============================================================================

print("📄 Generating main text report...")

# Calculate additional metrics for report
total_unique_agents = combined_agents_df['Agent Name'].nunique()
successful_50plus_all = combined_agents_df[combined_agents_df['Successful Calls'] >= 50]
successful_50plus_all_count = len(successful_50plus_all)

txt_report_path = os.path.join(output_dir, f"call_center_report_{report_date}.txt")

with open(txt_report_path, 'w', encoding='utf-8') as f:
    f.write(f"Hi,\nBelow is the call center summary report for {report_date}:\n\n")
    f.write("CALLS SUMMARY REPORT\n\n")
    f.write(f"- Total calls made for the day were {total_calls}, with {distinct_called_numbers} unique phone numbers being called (outbound) and {distinct_calling_numbers} unique phone numbers that called in (inbound).\n")
    f.write(f"- Out of the total {total_calls} calls, {communication_counts.get('Inbound', 0)} ({communication_counts.get('Inbound', 0)/total_calls:.1%}) were inbound calls, ")
    f.write(f"{communication_counts.get('Outbound', 0)} ({communication_counts.get('Outbound', 0)/total_calls:.1%}) were outbound calls and ")
    f.write(f"{communication_counts.get('Internal', 0)} ({communication_counts.get('Internal', 0)/total_calls:.1%}) were internal calls.\n")
    f.write(f"- Out of the total {total_calls} calls, {len(successful_calls)} ({len(successful_calls)/total_calls:.1%}) were successful and {len(unsuccessful_calls)} ({len(unsuccessful_calls)/total_calls:.1%}) were unsuccessful.\n")
    f.write(f"- Of the total {total_calls} calls made for the day the distribution of the calls disposition is visualized in the chart.\n\n")
    
    f.write("AGENTS PERFORMANCE HIGHLIGHTS\n\n")
    f.write(f"Day Performance Summary : - Of the total {total_unique_agents} agents who made calls, {successful_50plus_all_count} ({(successful_50plus_all_count/total_unique_agents):.1%}) had 50 or more successful calls for the day (Both inbound & outbound).\n\n")
    
    f.write("For Outbound calls:\n")
    f.write(f"- Average outbound calls made per agent was {avg_outbound_calls}\n")
    f.write(f"- Of the total {outbound_agents} agents who made outbound calls, {outbound_successful.groupby('Call From').filter(lambda x: len(x) >= 50)['Call From'].nunique()} ({(outbound_successful.groupby('Call From').filter(lambda x: len(x) >= 50)['Call From'].nunique()/outbound_agents):.1%}) Agents had 50 or more successful outbound calls for the day.\n")
    f.write(f"- {outbound_unsuccessful.groupby('Call From').filter(lambda x: len(x) >= 50)['Call From'].nunique()} ({(outbound_unsuccessful.groupby('Call From').filter(lambda x: len(x) >= 50)['Call From'].nunique()/outbound_agents):.1%}) Agents had 50 or more unsuccessful outbound calls for the day.\n\n")
    
    if inbound_total:
        f.write("For Inbound Calls:\n")
        f.write(f"- Average inbound calls received per agent was {avg_inbound_calls}\n")
        f.write(f"- Of the total {inbound_total} inbound calls, {len(inbound_successful)} ({inbound_successful_pct:.1%}) were successful and {len(inbound_unsuccessful)} ({inbound_unsuccessful_pct:.1%}) were unsuccessful.\n")
        f.write(f"- Of the {len(inbound_unsuccessful)} unsuccessful inbound calls, {len(called_back)} ({called_back_pct_inbound:.1%}) were called back.\n\n")
    else:
        f.write("No inbound calls recorded for the day.\n\n")
    

# =============================================================================
# STEP 15: COMPLETION MESSAGE
# =============================================================================

print(f"✅ Report generation completed!")
print(f"📁 Main files saved in: {output_dir}")
print(f"📊 Product-wise reports saved in:")
print(f"   - LBF: {lbf_dir}")
print(f"   - CS: {cs_dir}")
if len(err_agents) > 0:
    print(f"   - ERR: {err_dir}")
print(f"📄 Text reports generated for each product")
print(f"🖼️  Visualizations created for each product group")


# =============================================================================
# STEP 16: EMAIL AUTOMATION
# =============================================================================

print("\n" + "="*50)
print("STARTING EMAIL AUTOMATION")
print("="*50)

# Import the email functions (add at the top of your file)
from call_center_email import send_all_product_emails

# Send emails after report generation
try:
    integrate_email_automation(export_root, report_date)
    print("✅ Email automation completed successfully!")
except Exception as e:
    print(f"❌ Email automation failed: {e}")