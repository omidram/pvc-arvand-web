import type { Tree } from "./translations-extra";

function guide(title: string, body: string): Tree {
  return { title, body };
}

/** In-page manuals. A line that starts with "# " is a section heading. */
export const helpEn: Tree = {
  dashboard: guide(
    "Main menu",
    `# What this screen is
This is the front door of the program. Every white button opens one part of the plant records. The question mark on any later page explains only that page.
# The strip at the top
Plant Client, Type of Plant and Version come from Settings. You do not type them here. Exit signs you out. Your work is already saved when you pressed Save on a form.
# Left column — cells and the workshop
Element Administration opens the menu of assembly data, anode, cathode, membrane, segregation and inspection.
Cell Arrangement is the live board of every cell in one electrolyzer.
Search Functions finds an element, a serial, a date, a duplicate or stock.
Warehouse is the live rack: what is installed, out for repair, back from coating, or ready to install.
Workflow is your personal desk. Open a request, do your step, and send it to the next group.
# Middle — voltage and energy
Standardized Voltage is where operating voltage is entered and drawn.
Current Efficiency is the CE menu (anodic balance or caustic production).
Power Consumption draws specific energy for the plant, a train, an electrolyzer, a group or one cell.
Un / CE puts standardized voltage and current efficiency of the same day on one chart, and shows the energy number.
Test Run Results is the short table of a performance-test day: date, part of plant, CE and SPC.
# Right side — lab, statistics, shutdowns
Analysis opens the laboratory forms (anolyte, catholyte, brine, chlorine, hydrogen and the others).
Statistics opens voltage, membrane life and group comparisons.
Plant Shut Down is the trip log: when the plant stopped, why, and for how long.
Work activity (if you can see it) shows who entered what.
Process log is the history of workflow requests.
Tickets is how you ask the administrator for a fix or a new permission. A number on the button means unread replies.
# Far right
Remarks is a free notebook.
About explains the program and the legal pages.
Settings holds plant names, formulas, lists and connections. Only people with settings access see it.
Users and Audit Logs are for the administrator.
# If a button is missing
Your role hides sections you are not allowed to open. Ask the administrator in Tickets if you need one.`
  ),
  overview: guide(
    "Plant overview",
    `# What this screen is
A one-page picture of the plant: how many electrolyzers, elements, anodes, cathodes, membranes, shutdowns, inspections, analyses and voltage readings are stored.
# The charts
One chart splits elements into active and retired, by membrane type. The other adds shutdown hours by category. These are counts from the saved records, not a live DCS value.
# What to do
Read the numbers. To change a record, open the matching form from the menu (Element Administration, Plant Shut Down, and so on). The question mark on that form explains its own buttons.
# If the numbers look old
Leave the page and come back, or refresh the browser. The overview does not edit data.`
  ),
  elementsMenu: guide(
    "Element Administration menu",
    `# What this screen is
This menu does not hold the data itself. Each button opens one workbook of the cell shop.
# Top row
Assembly stock lists anodes and cathodes that are free to build a new element, plus membrane stock.
# Second row
Assembly Data is the main element sheet: element number, anode, cathode, membrane, place and the four dates (assembly, start-up, shut-down, disassembly).
Group Definition (in Settings) says which positions belong to which group.
Anode Details, Cathode Details and Membrane Details are the master cards of each serial.
# Third row
Electrode Segregation (TAFKIK) is the decision after a cell is taken apart: reuse, recoat, or write off.
Inspection Reasons is the lookup list used by inspection forms.
Anode / Cathode / Membrane Maintenance are the repair rows of that serial.
# Fourth row
Import Montage and Import Demontage open Assembly Data with the Excel import ready. Use the workshop workbook, not a random spreadsheet.
Maintenance Report (anode, cathode, membrane) attaches a PDF or photo to that serial.
# Fifth row
Cell Components is the spare-parts count (how many pieces per element).
Anode Recoating and Cathode Recoating are the coating-send and coating-return sheets.
Check of Anode Coating and Check of Cathode Coating are the pass / fail after the piece comes back.
# Bottom
Group overview shows which element sits in which group.
Membrane statistics opens the days-on-line table.
Assembly Inspection Report is the workshop checklist filled when a new element is built.
Element Inspection is the teardown inspection (half-shell maps included).
# How a normal job starts
New element: Workflow → assemble, or Assembly Data → new row. Taken-apart cell: segregation, then maintenance or recoating, then the piece returns to assembly stock.`
  ),
  elements: guide(
    "Assembly Data",
    `# What a row is
One row is one life of one element. It ties together the element number, the anode serial, the cathode serial, the membrane, the group, the electrolyzer, the position, and four dates.
# The four dates, in order
Assembly: the day the cell was built in the shop.
Commissioning / start-up: the day it went into service. Days-on-line start here.
Decommissioning: the day it was taken out of service. It can still be in the cell.
Disassembly: the day it was taken apart. After this the element is rate-off and does not go back into a cell. A new element is a new row.
# New element
Press New. The program suggests the next element number (highest existing number + 1). Pick a free anode and cathode. Membrane type shows only types that still have stock. Save. The same numbers then appear on the anode, cathode and membrane cards.
# Edit
Open the row (pencil or double-click, depending on the view). Change the field. Save. A blank required field is rejected and the old text stays.
# Filters and sort
Use the boxes above the table to keep one electrolyzer, one group, or one status. Click a column title to sort. The list is ordered so the highest element number is first.
# Import Montage / Demontage
Use this only for the workshop workbook. Import writes assembly or disassembly dates onto matching serials. Read the result line: how many rows were updated. A serial that does not exist is not invented.
# Export
Excel or PDF downloads the rows you are looking at, after filters.
# Who can change rows
View access can read and export. Edit access can add, change and delete. If Save does nothing, your role is view-only.
# Linked pages
From here you can open segregation, the element dashboard and the inspection of the same element number. Spelling must match the master (same digits, no extra spaces).`
  ),
  assemblyStock: guide(
    "Assembly stock",
    `# What this list is
Pieces that can be used for a new element right now.
Reusable: TAFKIK said the coating is good enough to build again.
Purchased: a new piece that has been registered and not yet built in.
Recoated: back from the coater, accepted, and not yet built in.
# Columns
Serial opens the anode or cathode card.
Kind is anode or cathode.
Company is the maker or the coater.
Quality is the segregation grade (good, medium, or not graded).
Reference is the batch, pallet or note.
Date is the day it became free.
# Build with one
The assemble link opens Assembly Data with that serial already chosen. You still pick the mate (the other electrode) and a membrane type that has stock.
# Membrane stock
On the same page, membrane types are listed with the quantity still in the cupboard. A type with zero is not offered when you start a new element.
# If a serial you expect is missing
It is still installed, still at the coater, waiting for a coating check, or written off. Open Warehouse or Segregation for that serial.`
  ),
  cellComponents: guide(
    "Cell components",
    `# What this sheet is
The spare-parts plan for one element: gaskets, spacers and the other pieces, and how many of each belong to one cell.
# Header numbers
Element count and spare count sit above the table. They are not stored on each row. Change them and the totals recalculate.
# The calculated columns
Parts per element × element count = total pieces in the plant.
Recommended reserve is about 2 percent of that total.
The spare calculation uses parts per element × spare count × the reserve index of that row.
# Edit
If you have edit access, change parts per element, the name or the reserve index and leave the cell. The row saves. View-only users can read and export.
# Export
Excel / PDF downloads this planning sheet. It does not order the parts.`
  ),
  groupOverview: guide(
    "Group overview",
    `# What this page is
A read-out of which element is in which group, built from Assembly Data and the group definition.
# How to read it
Each group lists the elements that carry that group number. An empty group means no current element is tagged with it.
# If a cell looks wrong
Do not fix it here. Open Assembly Data and set the group on that element, or open Settings → Groups if the position range itself is wrong.
# Back
The Elements button returns to the Element Administration menu.`
  ),
  anodes: guide(
    "Anodes",
    `# The four sheets
Anode Details is the master card: serial, manufacturer, drawing, coating, date received, date decommissioned.
Maintenance is a repair visit: date, what was done, remark.
Recoating is a trip to the coater: sent date, returned date, company.
Check of Anode Coating is the accept or reject after return.
# How the sheets stay together
Warehouse buttons write the same rows. If you send a serial to recoating from the warehouse, the recoating sheet grows a row and a workflow request opens. You do not type it twice.
# Find a serial
Use the serial box at the top. Related links jump to the elements that used this anode, its maintenance and its coating history.
# New serial
Add it on Anode Details, or register it from a purchase request in the Workflow. The serial must be typed the same way everywhere (no extra spaces).
# Export
Each sheet can download Excel or PDF of the rows on screen.`
  ),
  cathodes: guide(
    "Cathodes",
    `# The four sheets
Cathode Details is the master card: serial, manufacturer, drawing, coating, received and decommissioned dates.
Maintenance, Recoating and Check of Cathode Coating work exactly like the anode sheets.
# Warehouse
Send to maintenance, mark returned, and mark OK or NOT OK on the warehouse board write these same tables. Send to recoating opens the coating request for procurement.
# Find a serial
The combo at the top loads that cathode and its child rows. Related links open the elements that used it.
# Spelling
The dashboard and the stock lists join on the serial text. "K-12" and "K12" are not the same piece until someone merges them.`
  ),
  membranes: guide(
    "Membranes",
    `# Membrane Details
One row per membrane serial: type, batch, date received, date decommissioned, remarks.
# Membrane Maintenance
Repairs of that serial. Open a number and the history of that membrane appears. You can attach a PDF or a photo from the maintenance report.
# Stock
A membrane that is not mounted on a running element is stock. The new-element form only offers types whose stock quantity is above zero.
# Links
The membrane number on Assembly Data must match this master. Export downloads the list or the maintenance history.`
  ),
  segregation: guide(
    "Electrode segregation (TAFKIK)",
    `# What a row is
After a cell is taken apart, each anode and each cathode gets one decision: warranty, coating quality, voltage quality, pallet number, and what happens next (reuse, recoat, or rate off).
# Open it
From Element Administration. Form view edits one electrode. Datasheet view is the long list; click a row to edit it.
# Import
Import TAFKIK reads the workshop Excel. Match the columns of that workbook. After import, check a few serials you know before you trust the whole file.
# What the decision does
Reuse with good or medium coating puts the serial on assembly stock.
Recoat sends it toward the coating workflow.
Rate off means the piece does not go back on a cell.
# Export and rights
Excel / PDF downloads the current list. You can edit if your role can edit anodes, cathodes, or Element Administration.`
  ),
  inspections: guide(
    "Element inspection",
    `# What a report is
The teardown sheet of one element: blisters, tubes, spacers, gaskets, remarks, and the reason codes from Settings.
# Open
Each report is tied to an element number. Open the row to see the checklist. Grids are the 13 by 18 half-shell maps for the anode side, the cathode side and the membrane.
# Fill it in
Tick what you saw. A finding that is not in the list must be added under Settings → Inspection findings first, otherwise the dropdown cannot show it.
# Print
Export Excel or PDF for the file. View-only users can read and export; they cannot save a change.`
  ),
  assemblyInspection: guide(
    "Assembly inspection report",
    `# What this form is
The workshop checklist for building one element: anode side, membrane, cathode side, assembly and tests.
# Who signs, and in what order
In the new-element workflow, C-90 writes the assembly date and fills this form. Inspection signs. Process signs. If either rejects, they must write a note and the request goes back one step. After both signatures, C-90 sets the electrolyzer and the cell position.
# On the paper
Tick each activity when it is done. Header fields (electrolyzer, position, group, serials, membrane type) use the plant lists, so you pick rather than type a new spelling.
# Signature
Maintenance, Inspection and Process can draw a signature or upload a photo of one.
# PDF
Export PDF reprints the form for the paper file.`
  ),
  maintenanceReports: guide(
    "Maintenance report",
    `# What this page is
The file of one serial: anode, cathode or membrane, depending on which button you pressed.
# Steps
Type the serial and open it. The maintenance history of that number appears underneath.
Attach a PDF or a photo if you have the paper report. The file stays with that serial.
# If the history is empty
There is no maintenance row yet. Add the visit on Anode Maintenance, Cathode Maintenance or Membrane Maintenance, then come back to attach the scan.
# Back
Elements returns you to the Element Administration menu.`
  ),
  storage: guide(
    "Warehouse",
    `# What the board means
Every anode and cathode serial is in one place:
On the rack — its latest assembly row has no disassembly date.
Out for repair — an open maintenance row, or it was sent to the coater.
Returned — back from coating, waiting for the coating check.
OK — accepted, ready to install.
NOT OK — rejected.
# Days on line
Counted from installation (or from assembly if installation is empty) until disassembly, or until today if it is still in.
# Buttons
Send to maintenance writes a maintenance row.
Mark returned and OK / NOT OK write the coating-check result. The six electrode forms show the same rows.
Send to recoating opens a coating request in the Workflow and tells procurement. After that, follow the request; do not also type a second recoating row by hand.
# Sections of this page
The bar under the title switches the view: summary, inventory, elements, coating companies, coating requests, inspection requests, purchase, history, decommission, timeline of one serial.
# Membrane stock
Usable membranes that are not mounted. Quantity is what the new-element form is allowed to offer.
# Import
Montage / demontage can be imported here or from Assembly Data. Use the workshop file.`
  ),
  cartable: guide(
    "Workflow desk",
    `# What this page is
Your own work, not the whole plant. You see the requests that are waiting for your group. A counter means something is waiting. A red counter means it is late against the time limit set in Settings.
# Open a card
Click the row. The card shows the element or the serial, the history, and only the buttons your role may press.
# The usual requests
Coating: procurement sends a piece out, the coater returns it, inspection accepts or rejects.
Purchase: a new anode or cathode is registered into the master and into stock.
Cell: operation decides a switched-off cell (new position, or send to C-90). C-90 records the disassembly. The element becomes rate-off. Inspection then takes the anode and the cathode.
Inspection: the request to inspect a taken-apart cell.
Assemble: C-90 picks a free anode, a free cathode and a membrane type that has stock, writes the assembly date, fills the assembly inspection, gets the two signatures, then assigns electrolyzer and position.
Work order: labour on an element (see the Work orders page).
# Delete / cancel
Delete request cancels the request and tries to undo what it already wrote (stock, assembly row, recoating row). If you are an administrator, or the request is still on its first step and you created it, you must type the reason for cancellation first. The button stays clickable; if the reason is empty it tells you to fill it. Then confirm. A cancelled request does not come back. The serials go back to the state they had before the request.
# If you see "waiting for another group"
The card is not on your step. You can still read it. The person whose group is named does the next button.
# Messages and files
Where the card allows a comment, write it and send. Attach adds a file to that request only.`
  ),
  processHistory: guide(
    "Process log",
    `# What this list is
Every workflow request that has been opened: coating, purchase, cell, inspection, assemble and work order. It is the history, including finished and cancelled ones.
# Search
Type a code, an element number or a serial. The list narrows as you type.
# Flow filter
The dropdown keeps one kind of request. Empty means all kinds.
# Columns
Code is the request number. Flow is the kind. Element is the cell when the request has one. Status is where it stopped (open step, completed, cancelled). Work is a one-line summary. Updated is the last change.
# Open
Click a row. The steps appear underneath: who did what, and when. Open request jumps to the live card if it still exists.
# You cannot edit history here
To change an open request, open the card and use its own buttons.`
  ),
  workOrders: guide(
    "Work orders",
    `# What a work order is
A labour sheet for one element. It is separate from the coating and purchase requests.
# The list
Code, element, status, and five stage pills: generation, install, pickup, store, disassemble. A lit pill means that stage has hours or a date. Search and the status filter narrow the list. Click a row to open it.
# New
New opens a blank order. Pick the element, the dates and the note, then save. You need edit access. A finished or cancelled order cannot be edited.
# Inside the order
Jobs are the planned tasks. Actual lines are the hours really worked, per stage and per person. Add a line, fill the person and the hours, and save. Delete removes that line only.
# Close
Mark it completed when the work is done, or cancel it with a reason if it should not have been opened. Cancelling does not delete the element in Assembly Data.`
  ),
  shutdowns: guide(
    "Plant shut down",
    `# The menu
The top of the menu shows the trips of the current month and the three causes that repeated most. Click a month in the year strip to see why that month stopped.
Input (left): Shutdown list, Reasons, Categories, Trip causes.
Results (right): a time period, then totals by reason and by category.
# Shutdown list — one row
Part of plant (electrolyzer or the whole plant), shutdown time, start-up time, code, reason, category, kA before the trip, remarks.
Duration is calculated from the two times. You do not type it. If start-up is earlier than shutdown, duration stays zero until you fix the clock.
Chlorine lost and caustic lost are calculated from kA × duration. They are read-only.
A mark on the row means shutdown and start-up fall in calendar months that are one month apart, so the hours cross a month boundary.
# Add a trip
New row. Pick the part of plant. Set both times. Pick a code; the reason and the category fill from the cause list. Save. Code and reason are required.
# Edit
Change the cell and leave it, or press Save on that row. Export downloads the filtered list.
# Period
The period form asks for a from-date and a to-date and shows only trips inside that window. The plain list opens on all months.
# Reasons and trip causes
These are the lookup rows behind the code dropdown. Code, the text of the cause, and the category.
To fix a bad row: change the text and press Save.
To remove an empty row: press Delete and confirm. If you clear both the code and the cause and press Save, that is the same as delete. Leaving the page no longer brings a deleted row back.
Do not leave a row blank and expect Save to store it. A row with an empty code is rejected.
# Categories
The names used to group hours (electrical, mechanical, process, and so on). Add a name and save. Rename with care: summaries group by this text.
# Summaries
Reason, category and trip-cause summaries add the hours. They do not create trips. Use them for the monthly report, then export.`
  ),
  voltage: guide(
    "Standardized voltage",
    `# Two jobs on this page
Data input writes the measurements. The columns below draw them.
# Data input
Electrolyzers: one row per electrolyzer and time. I total, anode temperature, cathode temperature, concentration, total voltage, number of elements.
All elements: the cell voltages Ui of that same snapshot.
Groups and Single element: the Un tables, separate from the electrolyzer snapshot.
These electrolyzer and cell tables are the same ones the AriaORMS sync fills. A manual row and a synced row live together. Configure the sync in Settings → Voltage sync.
# The report columns
Each column is one scope: total plant, train, electrolyzer, groups, or elements.
Pick the basis, whether you want one unit or several, and chart or table. Then press the display button of that column. The picture uses the from / till dates at the top.
Several opens a box where you tick more than one electrolyzer, group or cell.
# How to read Un
Un is the standardized voltage, corrected toward the reference current density and the temperature and concentration factors from Settings. It is not the raw Ui.
# Export and rights
Where a sheet has Excel / PDF, it downloads that sheet. Editing a measurement needs voltage edit access.`
  ),
  currentEfficiency: guide(
    "Current efficiency",
    `# Data input
CE from NaOH production: one form each for total plant, train, electrolyzer, group and element. You enter the date and the CE percent. Train, electrolyzer, group and element forms also ask which unit.
# The report
Each column can use the anodic balance or the caustic production basis, for one unit or several, as a chart or a table. Set from / till, then display.
# Cathodic sheet
The train button opens the cathodic CE sheet: one day, one train, the cell grid. Fill the cells you have, then the sheet calculates. Empty required cells are listed so you can see what is missing.
# Formula guide
The formula button on this menu writes out the expression the program uses. Read it before you compare a number with a hand calculation.
# Caution
CE from operating data is only meaningful when current, voltage and the lab analyses are from the same day. The program does not invent the missing sample.`
  ),
  cathodicCe: guide(
    "Cathodic current-efficiency sheet",
    `# What you are looking at
One day and one train. The grid is the cathodic CE calculation for that train.
# Fill
Set the day. Enter the measured cells. Calculated cells fill themselves and cannot be typed.
# Missing
If you have started the sheet, the line under the grid names every code that is still empty (except concentration rows). Fill those, then read the result.
# Save
Leaving a typed cell stores it when the sheet saves. The back link returns to the Current Efficiency menu. This sheet does not change Assembly Data.`
  ),
  powerConsumption: guide(
    "Power consumption",
    `# What the number is
Specific energy of the chosen scope over the from / till dates. The columns are total plant, train, electrolyzer, group and element.
# Before you draw
Set the dates. In the column, choose chart or table, and for the smaller scopes choose one unit or several. Electrolyzer and group columns also ask which voltage table and which basis (anodic or caustic) to use.
# Display
Press the button of that column. Change a date and press it again; the old picture stays until you do.
# If the chart is empty
There is no standardized voltage and no CE in that window for that unit. Enter them first, or widen the dates.`
  ),
  unCe: guide(
    "Un / CE",
    `# What this page puts together
For the same electrolyzer and the same day: standardized voltage Un, current efficiency, and the specific energy SPC. SPC is Un × 100000 / (1.4923 × CE), the same expression as the original Access queries.
# Choices
From and till dates. One electrolyzer, or the whole plant. Which Un table. CE from the anodic balance or from caustic production. Chart or table.
# Display
Press the plant button or the electrolyzer button after the choices. The table columns are electrolyzer, date, current density, Un, CE, energy and the reference current density.
# Settings
The small settings panel on the page is the reference used by that calculation. Plant-wide factors still live in Settings.
# If a day is missing
That day has voltage without CE, or CE without voltage. The row cannot invent the missing half.`
  ),
  testRunResults: guide(
    "Test run results",
    `# What a row is
One performance test: date, part of plant, CE percent and SPC. The plant name, the NaCl/KOH line and the UAN at the top come from Settings.
# Add
Use the new row. Date and part of plant identify the test. Type CE and SPC as numbers. Save.
# Edit
Click the row, change the cell, and save. You need voltage edit access. View-only can read and export.
# Filters
The header of each column filters the sheet. Export downloads the rows you see.
# This is not the daily CE form
Daily CE belongs in Current Efficiency. This sheet is only the formal test-run record.`
  ),
  plantCharts: guide(
    "Plant charts",
    `# What the lines are
Voltage, current (kA) and power (kW) on one time axis, for the whole plant, one train, or one electrolyzer.
# Range
Last 10, 30 or 90 days, one year, two years, or a from / till range you type.
# Ticks
Turn each line on or off. A line with no measurements in that window stays empty; that is not a zero.
# Read a point
Hover the chart. The date and the three values appear. These are the stored operating snapshots, not a forecast.`
  ),
  analyses: guide(
    "Analysis",
    `# The menu
Five columns: total plant, train, electrolyzer, group, element. Each button is one sample type. A gap in a column means that sample is not taken at that level (for example a group has no hydrogen button).
# Sample types
Anolyte, catholyte, hydrochloric acid, pure brine, chlorine, hydrogen, demineralized water, lean caustic. Pure brine is two columns on the form: salts on the left, trace metals on the right. The other forms show only their own values and units.
# What the form asks
Total plant: date and time. Train adds the train. Electrolyzer adds the electrolyzer. Group adds the group. Element adds the electrolyzer and the position.
# Form view and datasheet
Form view edits one sample. Datasheet view is the list. Save stores that sample. Save and next keeps the same electrolyzer, date and time and opens the other form of that level.
# Import
Administrators can import a workbook from this menu. Read the progress line. A second import of the same file does not ask you twice; check the result count.
# Current Efficiency button
Jumps to the CE menu, because CE is calculated from these samples plus the current.
# Export
On an open section, Excel / PDF downloads that section only.`
  ),
  statistics: guide(
    "Statistics",
    `# Single-element voltages
Pick the electrolyzer first. The three buttons then open that electrolyzer only.
Element voltages: Un of each cell.
High voltages: the cells that sit above the high-voltage line.
Distribution of Un: how many cells fall in each voltage class. The class limits are in Settings → Voltage classes. Press Update display after you change the date.
# Power consumption
Opens the electrolyzer comparison of specific energy inside this statistics book.
# Membranes
DOL is days on line by membrane type: how long each type has been running. It is a report, not an editor.
# Groups
Three reports: the average of a group by date, the group values by date, and the average by electrolyzer and date.
# Update display
On a form that has this button, the picture does not move until you press it.
# Export
Where the sheet offers Excel or PDF, it exports the table you see.`
  ),
  reports: guide(
    "Reports and analysis",
    `# What this page collects
One management pack: voltage averages and outliers, shutdown hours by category, current-efficiency figures, and days-on-line.
# Filter
The electrolyzer box limits the pack to one electrolyzer. Empty means the whole plant. The charts underneath show the monthly voltage and shutdown pattern of that filter.
# Export
Excel or PDF builds the pack you are looking at. Use it for a review. Changing a number is done in the original form (voltage, shutdowns, CE), not here.`
  ),
  search: guide(
    "Search",
    `# Two ways
The buttons repeat the original search menu. The box above them searches across the program.
# Buttons that ask for a word
Element, anode, cathode, membrane, electrolyzer, group, remarks, membrane type, recoating. Click the button, type the text, confirm. Partial text is enough if you are not sure of the full serial.
# Buttons that run immediately
Active elements, passive elements, days on line, the DOL list, duplicates (the same serial on two rows), stock, active groups.
# Buttons that ask for a date
Assembly, commissioning, decommissioning, disassembly. You get the elements whose that date matches.
# The result
A table opens under the buttons. Click a row to go to that element or that serial. If the table is empty, nothing matched; try a shorter word.
# Duplicates
A duplicate search is how you find the same anode typed on two live elements. Fix the wrong row in Assembly Data; this page does not edit.`
  ),
  arrangement: guide(
    "Cell arrangement",
    `# The board
Every position of the electrolyzer you picked. A filled cell shows the element that is installed there now. An empty cell has no current element.
# Click a cell
The side panel is that position: the installation, and the anode, cathode, membrane, inspections, half-shell maps, voltage and current efficiency that belong to it. They stay tied by element number and position.
# Edit
Change the installation or start a new one from the panel, then save. Press Update display so the board repaints. If you do not see the new element, you have not updated the display yet.
# Blocks
Which positions belong to which block is Settings → Arrangements, not this board.
# Two elements in one cell
The board shows the current installation. If a conflict is reported on the element dashboard, two rows in Assembly Data claim the same position. Keep the real one and clear the other.`
  ),
  remarks: guide(
    "Remarks",
    `# What a row is
A dated note that does not belong on a structured form: a phone call, a temporary bypass, a reminder.
# Columns
Number is given by the program. Date is the day of the note. Remark is the text.
# Add and edit
New row, type the date and the text, save. Click an existing row to change it. Delete removes that note only.
# Filter and export
Each column header can filter. Excel / PDF downloads the notes you see.
# Rights
Edit access on Remarks is required to save. View access can read and export.`
  ),
  settings: guide(
    "Settings",
    `# Plant
Customer name, UAN, plant type (NaOH or KOH), acidification, reference current density and the zero-voltage constant. These feed the headers and the Un calculation. Save on that tab before you leave it.
# Name lists
Electrolyzers, sub-plants, full plants, rectifiers, transformers. Number plus name. The electrolyzer names are the ones every combo in the program offers. Add a new cell room here before you try to type it on a form.
# Arrangements
One block: name, sub-plant, transformer, rectifier, start position, end position. Cell Arrangement uses this to draw the board.
# Reserve positions
Positions that are spares, not running cells.
# Correction factors and electrode area
The temperature and concentration corrections, and the square metres of one electrode. Un and current density use these. Do not change them to "make a chart look right".
# Voltage classes
The buckets of the Un distribution chart: a label, a lower bound, an upper bound.
# Groups
Which element positions form group 1, group 2, and so on.
# Inspection reasons and findings
The codes offered on the inspection forms. Selected-by-default ticks the line when a new report opens. Count shows how many reports already use it.
# Field lists
Every dropdown in the program (membrane type, manufacturer, coating, and the rest). Rename, merge or delete writes through every form and every old record that used that word. Membrane types here are the same names as membrane stock.
# Appearance
Whether forms open as a table (datasheet) or as a single record (form). Datasheet is safer: you double-click the row you mean.
# Minimum requirements
The computer and server spec the program expects. It does not test your PC; it is the list for whoever installs the machine.
# Import / export
For authorized users: bring a workbook or an Access extract in, or send data out. Read the progress line. Import replaces or appends according to the choice on that tab; it is not an undo button.
# Workflow time limits
How many hours a request may sit on a step before the cartable marks it late.
# Planner jobs
Scheduled jobs the server runs. Leave them unless you were told to change a clock.
# Backup
Download a copy of the database. Do this before a large import.
# Voltage sync and AriaLIMS sync
The addresses and the switch for the automatic pull. A bad address stops new rows; it does not delete old ones.
# Table files
Administrator only. Each table, the Excel file last loaded, its size, and the row count. Delete removes the file and the rows. Upload replaces the whole table.
# Database
Administrator only. Where the database file is, download it, or point the program at another server. Do this only with the plant stopped and a backup in hand.
# Active Directory
Administrator only. Tie sign-in to the Windows domain so only listed users or a domain group can open the program.
# Rights
Most tabs need settings edit. Visitors can look. Users, logs, database and directory need the administrator.`
  ),
  users: guide(
    "Users and roles",
    `# Who can open this page
Only the administrator. Everyone else is turned away.
# Users tab
Create the person: username, full name, password. Privilege is Admin, User or Visitor. Admin can open users and logs. Visitor can look but not save. User is the normal operator.
Assign a named role, or a custom matrix for this one person. Leave the password blank when you edit, if you want to keep the current password.
# Roles tab
A role is a reusable column of rights. For each menu: None hides it completely (main menu, sidebar and All forms). View can read and export. Edit can save.
The built-in Inspector role shows Voltage and Monitoring and hides the rest. Copy it if you need a similar job.
# A person who cannot see a button
Their role has None on that section. Change the role, or set a custom matrix on the user. They must sign out and sign in again.
# Do not share one login
The audit log records the username. A shared password makes the history useless.`
  ),
  logs: guide(
    "Audit log",
    `# Who can open this page
Only the administrator.
# What is recorded
Every sign-in, successful or not. Every password change. Every save, change and delete, with the username, the computer address, the time, the form, and the old and new values.
Passwords and tokens are stored as a blank. You will not see them here.
# Read a row
Click it. The detail lists each field that changed.
# Filter and export
Narrow by user or by date, then Excel or PDF if you need to hand the list to someone.
# This page does not undo
To put a value back, open the original form and type it again. The log only proves who changed it.`
  ),
  activity: guide(
    "Work activity",
    `# What this page is
Who did what, between two dates. It reads the audit trail and groups it so a supervisor can see the workshop, the warehouse, the lab and the inspectors without opening the raw log.
# Filters
From, to, a role, and a username. Refresh reloads. The cards and the tabs all use this same window.
# Summary
Counts per person and per kind of work. Click a person for the list of their events.
# Events
The raw lines: time, user, what changed. Export Excel downloads this list.
# Cell shop, warehouse, lab, inspection
The same window, split by the place of the work. Inspection has both the inspection reports and the assembly-inspection reports.
# Empty
No activity in this period means nobody saved a row between those dates. Widen the dates before you assume a person did not work.`
  ),
  tickets: guide(
    "Tickets",
    `# What a ticket is
A message to the administrator: a wrong number, a missing permission, a program fault. Every signed-in person can open this page, whatever their role.
# Write one
New ticket. A short title, then the description: which page, which element or serial, what you expected, what happened. Send.
# The thread
Open your ticket to read the reply. Write back in the same ticket. Do not open a second ticket for the same problem.
# The number on the menu
It is the count of replies you have not opened. Open the ticket and it clears.
# What a ticket does not do
It does not change data and it does not grant a permission by itself. The administrator does that in Users or on the form.`
  ),
  monitoring: guide(
    "Monitoring and alerts",
    `# Overview
The latest picture of the electrolyzers: voltage, current and the counts that are worth a look. It refreshes about once a minute. It is not the place you type a measurement.
# Cell health
A board of every cell. Colour marks the cells the rules consider off. Click through to the element if you need the assembly row.
# Alerts
The inbox of open warnings (a high cell voltage, a missing sample, a late request). Open one, read why it fired, and close it when the plant condition is gone. Closing the alert does not fix the cell.
# Rules
Which limits create an alert, and who is told. Change a limit only when the plant has agreed the new number. A limit of zero can either shout all day or never shout; read the label before you save.
# Rights
Voltage viewers can open the overview. Editing rules needs the matching edit access.`
  ),
  about: guide(
    "About",
    `# The card
Program name, the plant, and the version. The version must match what the administrator last installed. If the menu shows an older version than you were told, the server has not been updated.
# Trust
Sign-in is required. Each person sees only the menus of their role. The database stays on the plant server. The program does not send your rows to an outside service. Saves are written to the audit log.
# The documents
License, the end-user agreement, terms of use, privacy and security. Each card opens that text. Read them; they are the rules for using this copy.
# This page changes nothing
There is no save here.`
  ),
  allTables: guide(
    "All forms and tables",
    `# What the groups are
Every form you are allowed to see, in groups: elements, components, operations, settings, system. A form your role hides does not appear.
# Preview
Click a name. The newest rows open underneath. Click again to close.
# Export and open
Each preview has its own Excel and PDF. Open form goes to the real page, where you can filter and, if your role allows, edit.
# Use this when you are lost
If you know the data but not the menu button, find the table name here.`
  ),
  databaseTables: guide(
    "All tables",
    `# What this list is
The original database tables, including the ones that have no pretty form.
# Find one
Search by table name or by a column name. Then keep only one category, or hide the empty tables.
# Inside a table
Preview, search, filter, and if you have edit access add, change or delete a row. Export Excel or PDF.
# Be careful
These tables are the storage, not a report. Deleting a row here deletes it everywhere that report reads it. Prefer the normal form when one exists.`
  ),
  elementReport: guide(
    "Element report and dashboard",
    `# This button opens the picture guide
The question mark on Element Report and on the Element Dashboard opens the full guide: where the numbers come from, the life of an element, every tab, every field, how the tables join, and the jobs of a normal day.
# Read it in this order
What it is. Where to find it. The life cycle. The small report on the main menu. The tabs. The fields. The links between tables. The six daily jobs. The warnings at the end.
# The short version
In service means the element is running. After disassembly it is rate-off and does not return. Coating life is counted from the last return, not from the day the metal was new. A manual shop stage is kept only until a newer assembly date is saved.`
  ),
};

export const helpFa: Tree = {
  dashboard: guide(
    "منوی اصلی",
    `# این صفحه چیست
درِ ورود برنامه است. هر دکمهٔ سفید یک بخش از اطلاعات واحد را باز می‌کند. علامت سؤال بالای هر صفحهٔ بعدی، فقط همان صفحه را توضیح می‌دهد.
# نوار بالا
نام واحد، نوع واحد و نسخه از تنظیمات می‌آید. اینجا تایپ نمی‌شوند. خروج شما را از برنامه بیرون می‌برد. کاری که با دکمهٔ ذخیره ثبت کرده‌اید از بین نمی‌رود.
# ستون چپ — سل و کارگاه
مدیریت المنت منوی اطلاعات مونتاژ، آند، کاتد، ممبران، تفکیک و بازرسی است.
چیدمان سل، تابلوی زندهٔ همهٔ سل‌های یک الکترولایزر است.
جستجو، المنت، سریال، تاریخ، تکراری‌ها و موجودی را پیدا می‌کند.
انبار نشان می‌دهد چه چیزی نصب است، برای تعمیر بیرون رفته، از پوشش برگشته، یا آمادهٔ نصب است.
کارتابل میز کار خود شماست. درخواست را باز کنید، کار خودتان را انجام دهید و به گروه بعدی بفرستید.
# وسط — ولتاژ و انرژی
ولتاژ استاندارد جایی است که ولتاژ بهره‌برداری وارد و رسم می‌شود.
راندمان جریان منوی CE است (موازنهٔ آندی یا تولید سود).
مصرف انرژی، انرژی ویژهٔ کل واحد، یک ترین، یک الکترولایزر، یک گروه یا یک سل را می‌کشد.
Un / CE ولتاژ استاندارد و راندمان همان روز را روی یک نمودار می‌گذارد و عدد انرژی را نشان می‌دهد.
نتایج تست ران جدول کوتاه یک روز آزمون است: تاریخ، بخش واحد، راندمان و انرژی ویژه.
# سمت راست — آزمایشگاه، آمار، خاموشی
آنالیز فرم‌های آزمایشگاه را باز می‌کند (آنولیت، کاتولیت، آب‌نمک، کلر، هیدروژن و بقیه).
آمار ولتاژ، عمر ممبران و مقایسهٔ گروه‌ها را باز می‌کند.
خاموشی واحد دفتر تریپ است: کی واحد خوابید، چرا، و چند ساعت.
فعالیت کار (اگر می‌بینیدش) نشان می‌دهد چه کسی چه چیزی وارد کرده است.
سابقهٔ فرایند، تاریخ درخواست‌های کارتابل است.
تیکت راه حرف زدن با مدیر سیستم است: خرابی، یا دسترسی‌ای که ندارید. عدد روی دکمه یعنی جواب نخوانده دارید.
# ستون آخر
یادداشت دفتر آزاد است.
درباره، برنامه و متن‌های قانونی را توضیح می‌دهد.
تنظیمات نام واحد، فرمول‌ها، فهرست‌ها و اتصال‌ها را نگه می‌دارد. فقط کسی که دسترسی تنظیمات دارد آن را می‌بیند.
کاربران و گزارش ممیزی مخصوص مدیر سیستم است.
# اگر دکمه‌ای را نمی‌بینید
نقش شما بخش‌هایی را که اجازه ندارید پنهان می‌کند. در تیکت از مدیر سیستم همان دسترسی را بخواهید.`
  ),
  overview: guide(
    "نمای کلی واحد",
    `# این صفحه چیست
یک صفحه خلاصه از واحد: چند الکترولایزر، المنت، آند، کاتد، ممبران، خاموشی، بازرسی، آنالیز و قرائت ولتاژ در برنامه ذخیره شده است.
# نمودارها
یک نمودار المنت‌های فعال و خارج‌شده را بر اساس نوع ممبران جدا می‌کند. نمودار دیگر ساعت خاموشی را بر اساس دسته جمع می‌کند. این‌ها شمارش رکوردهای ذخیره‌شده است، نه عدد زندهٔ اتاق کنترل.
# چه کار کنید
عددها را بخوانید. برای عوض کردن یک رکورد، فرم خودش را از منو باز کنید (مدیریت المنت، خاموشی واحد، و بقیه). علامت سؤال همان فرم دکمه‌های خودش را توضیح می‌دهد.
# اگر عددها کهنه به نظر می‌رسند
از صفحه بیرون بروید و برگردید، یا مرورگر را تازه کنید. این صفحه خودش داده‌ای را عوض نمی‌کند.`
  ),
  elementsMenu: guide(
    "منوی مدیریت المنت",
    `# این صفحه چیست
خودِ داده اینجا نیست. هر دکمه یک دفتر کارگاه سل را باز می‌کند.
# ردیف بالا
موجودی مونتاژ، آند و کاتدی را نشان می‌دهد که همین حالا برای ساخت المنت آزادند، به‌اضافهٔ موجودی ممبران.
# ردیف دوم
اطلاعات مونتاژ برگهٔ اصلی المنت است: شمارهٔ المنت، آند، کاتد، ممبران، محل، و چهار تاریخ (مونتاژ، راه‌اندازی، خروج از سرویس، دمونتاژ).
تعریف گروه (در تنظیمات) می‌گوید کدام پوزیشن مال کدام گروه است.
مشخصات آند، کاتد و ممبران شناسنامهٔ هر سریال است.
# ردیف سوم
تفکیک الکترود (TAFKIK) تصمیم بعد از باز کردن سل است: استفادهٔ دوباره، پوشش، یا اسقاط.
دلایل بازرسی فهرست کدهایی است که فرم بازرسی استفاده می‌کند.
تعمیرات آند و کاتد و ممبران، ردیف‌های تعمیر همان سریال است.
# ردیف چهارم
ورود مونتاژ و ورود دمونتاژ، اطلاعات مونتاژ را با آمادهٔ خواندن اکسل باز می‌کند. فقط فایل کارگاه را بدهید.
گزارش تعمیرات (آند، کاتد، ممبران) یک PDF یا عکس را به همان سریال می‌چسباند.
# ردیف پنجم
قطعات سل، شمارش قطعات یدکی است (از هر قطعه چند تا برای یک المنت).
پوشش آند و پوشش کاتد، برگهٔ فرستادن و برگشتن از پوشش است.
بازرسی پوشش آند و کاتد، قبول یا رد بعد از برگشتن قطعه است.
# پایین
نمای گروه نشان می‌دهد کدام المنت در کدام گروه است.
آمار ممبران جدول روزهای در سرویس را باز می‌کند.
گزارش بازرسی مونتاژ، چک‌لیست کارگاه هنگام ساخت المنت جدید است.
بازرسی المنت، بازرسی بعد از باز کردن سل است و نقشهٔ نیم‌پوسته را هم دارد.
# یک کار معمولی از کجا شروع می‌شود
المنت جدید: کارتابل و مونتاژ، یا یک ردیف جدید در اطلاعات مونتاژ. سل بازشده: تفکیک، بعد تعمیر یا پوشش، بعد برگشت همان قطعه به موجودی مونتاژ.`
  ),
  elements: guide(
    "اطلاعات مونتاژ",
    `# یک ردیف یعنی چه
یک ردیف، یک عمر از یک المنت است. شمارهٔ المنت، سریال آند، سریال کاتد، ممبران، گروه، الکترولایزر، پوزیشن و چهار تاریخ را به هم گره می‌زند.
# چهار تاریخ، به ترتیب
مونتاژ: روزی که سل در کارگاه بسته شد.
راه‌اندازی: روزی که به سرویس رفت. روزهای در سرویس از اینجا حساب می‌شود.
خروج از سرویس: روزی که از مدار خارج شد. ممکن است هنوز داخل سل باشد.
دمونتاژ: روزی که باز شد. بعد از این، المنت Rate off است و به سل برنمی‌گردد. المنت بعدی یک ردیف تازه است.
# المنت جدید
دکمهٔ جدید. برنامه شمارهٔ بعدی را پیشنهاد می‌کند (بزرگ‌ترین شمارهٔ موجود به‌اضافهٔ یک). یک آند آزاد و یک کاتد آزاد انتخاب کنید. نوع ممبران فقط نوع‌هایی را نشان می‌دهد که هنوز در انبار موجودی دارند. ذخیره کنید. همان شماره‌ها روی کارت آند و کاتد و ممبران هم دیده می‌شوند.
# ویرایش
ردیف را باز کنید. فیلد را عوض کنید. ذخیره کنید. اگر فیلد اجباری را خالی کنید، برنامه قبول نمی‌کند و متن قبلی می‌ماند.
# فیلتر و مرتب‌سازی
جعبه‌های بالای جدول یک الکترولایزر، یک گروه یا یک وضعیت را نگه می‌دارند. روی عنوان ستون بزنید تا مرتب شود. فهرست طوری چیده شده که بزرگ‌ترین شمارهٔ المنت بالا باشد.
# ورود مونتاژ و دمونتاژ
فقط برای فایل کارگاه. ورود، تاریخ مونتاژ یا دمونتاژ را روی سریال‌های مطابق می‌نویسد. خط نتیجه را بخوانید: چند ردیف عوض شد. سریالی که وجود ندارد ساخته نمی‌شود.
# خروجی
اکسل یا PDF همان ردیف‌هایی را می‌دهد که بعد از فیلتر می‌بینید.
# چه کسی می‌تواند عوض کند
دسترسی مشاهده می‌تواند بخواند و خروجی بگیرد. دسترسی ویرایش می‌تواند اضافه، عوض و حذف کند. اگر ذخیره هیچ کاری نکرد، نقش شما فقط مشاهده است.
# صفحه‌های مرتبط
از اینجا تفکیک، داشبورد المنت و بازرسی همان شماره باز می‌شود. املای سریال باید با شناسنامه یکی باشد (همان رقم‌ها، بدون فاصلهٔ اضافه).`
  ),
  assemblyStock: guide(
    "موجودی مونتاژ",
    `# این فهرست چیست
قطعه‌هایی که همین حالا می‌شود با آن‌ها المنت ساخت.
قابل استفاده: تفکیک گفته پوشش برای ساخت دوباره کافی است.
خریداری‌شده: قطعهٔ نو که ثبت شده و هنوز داخل المنت نرفته.
پوشش‌شده: از پوشش برگشته، قبول شده، و هنوز داخل المنت نرفته.
# ستون‌ها
سریال، کارت آند یا کاتد را باز می‌کند.
نوع، آند یا کاتد است.
شرکت، سازنده یا پوشش‌دهنده است.
کیفیت، درجهٔ تفکیک است (خوب، متوسط، یا درجه‌نخورده).
مرجع، بچ یا پالت یا یادداشت است.
تاریخ، روزی است که قطعه آزاد شده.
# ساختن با یک سریال
پیوند مونتاژ، اطلاعات مونتاژ را با همان سریال از پیش انتخاب‌شده باز می‌کند. هنوز باید جفتش (الکترود دیگر) و یک نوع ممبرانِ دارای موجودی را انتخاب کنید.
# موجودی ممبران
در همین صفحه نوع ممبران با تعداد باقی‌مانده در قفسه دیده می‌شود. نوعی که موجودی‌اش صفر است، هنگام ساخت المنت جدید پیشنهاد نمی‌شود.
# اگر سریالی را که انتظار دارید نمی‌بینید
هنوز نصب است، هنوز پیش پوشش‌دهنده است، منتظر بازرسی پوشش است، یا اسقاط شده. برای همان سریال انبار یا تفکیک را باز کنید.`
  ),
  cellComponents: guide(
    "قطعات سل",
    `# این برگه چیست
برنامهٔ قطعات یدکی یک المنت: واشر، اسپیسر و بقیه، و اینکه از هر کدام چند تا مال یک سل است.
# عددهای سربرگ
تعداد المنت و تعداد یدکی بالای جدول‌اند و روی هر ردیف ذخیره نمی‌شوند. عوضشان کنید تا جمع‌ها دوباره حساب شود.
# ستون‌های محاسبه‌شده
تعداد در هر المنت ضربدر تعداد المنت می‌شود کل قطعه در واحد.
ذخیرهٔ پیشنهادی حدود دو درصد همان کل است.
محاسبهٔ یدکی از تعداد در هر المنت، ضربدر تعداد یدکی، ضربدر ضریب ذخیرهٔ همان ردیف به دست می‌آید.
# ویرایش
اگر دسترسی ویرایش دارید، تعداد در هر المنت یا نام یا ضریب را عوض کنید و از خانه بیرون بیایید. ردیف ذخیره می‌شود. کاربر فقط‌مشاهده می‌تواند بخواند و خروجی بگیرد.
# خروجی
اکسل یا PDF همین برگهٔ برنامه‌ریزی را می‌دهد. سفارش خرید نمی‌سازد.`
  ),
  groupOverview: guide(
    "نمای گروه",
    `# این صفحه چیست
نشان می‌دهد کدام المنت در کدام گروه است. از اطلاعات مونتاژ و تعریف گروه ساخته می‌شود.
# چطور بخوانید
هر گروه، المنت‌هایی را فهرست می‌کند که همان شمارهٔ گروه را دارند. گروه خالی یعنی هیچ المنت جاری‌ای با آن برچسب نخورده است.
# اگر یک سل غلط به نظر می‌رسد
اینجا درستش نکنید. در اطلاعات مونتاژ گروه همان المنت را بگذارید. اگر خودِ محدودهٔ پوزیشن غلط است، تنظیمات و تب گروه‌ها را باز کنید.
# برگشت
دکمهٔ المنت‌ها به منوی مدیریت المنت برمی‌گردد.`
  ),
  anodes: guide(
    "آندها",
    `# چهار برگه
مشخصات آند شناسنامه است: سریال، سازنده، شمارهٔ نقشه، پوشش، تاریخ دریافت، تاریخ اسقاط.
تعمیرات یک مراجعهٔ تعمیر است: تاریخ، کار انجام‌شده، توضیح.
پوشش یک رفت‌وبرگشت به پوشش‌دهنده است: تاریخ ارسال، تاریخ برگشت، شرکت.
بازرسی پوشش آند، قبول یا رد بعد از برگشت است.
# برگه‌ها چطور با هم می‌مانند
دکمه‌های انبار همان ردیف‌ها را می‌نویسند. اگر از انبار یک سریال را به پوشش بفرستید، برگهٔ پوشش یک ردیف تازه می‌گیرد و یک درخواست در کارتابل باز می‌شود. دوباره دستی واردش نکنید.
# پیدا کردن سریال
جعبهٔ سریال بالای صفحه را به کار ببرید. پیوندهای مرتبط، المنت‌هایی را که از این آند استفاده کرده‌اند و تاریخ تعمیر و پوشش را باز می‌کنند.
# سریال نو
در مشخصات آند اضافه کنید، یا از درخواست خرید در کارتابل ثبت کنید. سریال باید همه‌جا یک‌جور تایپ شود (بدون فاصلهٔ اضافه).
# خروجی
هر برگه می‌تواند اکسل یا PDF ردیف‌های روی صفحه را بدهد.`
  ),
  cathodes: guide(
    "کاتدها",
    `# چهار برگه
مشخصات کاتد شناسنامه است: سریال، سازنده، نقشه، پوشش، تاریخ دریافت و اسقاط.
تعمیرات، پوشش و بازرسی پوشش کاتد درست مثل برگه‌های آند کار می‌کنند.
# انبار
فرستادن به تعمیر، ثبت برگشت، و علامت سالم یا ناسالم روی تابلوی انبار همین جدول‌ها را می‌نویسند. فرستادن به پوشش، درخواست پوشش را برای تدارکات باز می‌کند.
# پیدا کردن سریال
فهرست بالای صفحه همان کاتد و ردیف‌های وابسته‌اش را می‌آورد. پیوندهای مرتبط، المنت‌هایی را که از آن استفاده کرده‌اند باز می‌کنند.
# املا
داشبورد و فهرست موجودی با متن سریال به هم وصل می‌شوند. «K-12» و «K12» تا وقتی کسی یکی‌شان کند، یک قطعه نیستند.`
  ),
  membranes: guide(
    "ممبران‌ها",
    `# مشخصات ممبران
یک ردیف برای هر سریال: نوع، بچ، تاریخ دریافت، تاریخ اسقاط، توضیحات.
# تعمیرات ممبران
تعمیرهای همان سریال. شماره را باز کنید تا سابقه بیاید. از گزارش تعمیرات می‌توانید PDF یا عکس بچسبانید.
# موجودی
ممبرانی که روی المنت در حال کار نیست، موجودی است. فرم المنت جدید فقط نوع‌هایی را پیشنهاد می‌کند که موجودی‌شان بیشتر از صفر است.
# ارتباط
شمارهٔ ممبران در اطلاعات مونتاژ باید با این شناسنامه یکی باشد. خروجی، فهرست یا سابقهٔ تعمیر را می‌دهد.`
  ),
  segregation: guide(
    "تفکیک الکترود",
    `# یک ردیف یعنی چه
بعد از باز شدن سل، هر آند و هر کاتد یک تصمیم می‌گیرد: گارانتی، کیفیت پوشش، کیفیت ولتاژ، شمارهٔ پالت، و کار بعدی (استفادهٔ دوباره، پوشش، یا اسقاط).
# باز کردن
از مدیریت المنت. نمای فرم یک الکترود را ویرایش می‌کند. نمای جدول فهرست بلند است؛ روی ردیف بزنید تا باز شود.
# ورود از اکسل
ورود TAFKIK فایل اکسل کارگاه را می‌خواند. ستون‌ها باید مال همان فایل باشند. بعد از ورود چند سریال آشنا را چک کنید، بعد به کل فایل اعتماد کنید.
# تصمیم چه می‌کند
استفادهٔ دوباره با پوشش خوب یا متوسط، سریال را به موجودی مونتاژ می‌برد.
پوشش، آن را به سمت فرایند پوشش می‌فرستد.
اسقاط یعنی قطعه به سل برنمی‌گردد.
# خروجی و دسترسی
اکسل یا PDF فهرست جاری را می‌دهد. اگر نقش شما اجازهٔ ویرایش آند، کاتد یا مدیریت المنت را بدهد، می‌توانید ردیف را عوض کنید.`
  ),
  inspections: guide(
    "بازرسی المنت",
    `# یک گزارش چیست
برگهٔ باز کردن یک المنت: تاول، تیوب، اسپیسر، واشر، توضیحات، و کدهای دلیل از تنظیمات.
# باز کردن
هر گزارش به یک شمارهٔ المنت بسته است. ردیف را باز کنید تا چک‌لیست را ببینید. شبکه‌ها نقشهٔ ۱۳ در ۱۸ نیم‌پوسته برای سمت آند، سمت کاتد و ممبران است.
# پر کردن
هر چه دیدید را علامت بزنید. اگر یافته‌ای در فهرست نیست، اول در تنظیمات و یافته‌های بازرسی اضافه‌اش کنید، وگرنه در فهرست نمی‌آید.
# چاپ
خروجی اکسل یا PDF برای بایگانی. کاربر فقط‌مشاهده می‌تواند بخواند و خروجی بگیرد و نمی‌تواند ذخیره کند.`
  ),
  assemblyInspection: guide(
    "گزارش بازرسی مونتاژ",
    `# این فرم چیست
چک‌لیست کارگاه برای بستن یک المنت: سمت آند، ممبران، سمت کاتد، مونتاژ و آزمون‌ها.
# چه کسی امضا می‌کند و به چه ترتیب
در فرایند المنت جدید، C-90 تاریخ مونتاژ را می‌نویسد و این فرم را پر می‌کند. بازرسی امضا می‌کند. فرایند امضا می‌کند. اگر یکی رد کند باید توضیح بنویسد و درخواست یک گام برمی‌گردد. بعد از هر دو امضا، C-90 الکترولایزر و پوزیشن سل را می‌گذارد.
# روی برگه
هر کار را که انجام شد علامت بزنید. فیلدهای سربرگ (الکترولایزر، پوزیشن، گروه، سریال‌ها، نوع ممبران) از فهرست واحد می‌آیند؛ انتخاب کنید و املای تازه نسازید.
# امضا
تعمیرات، بازرسی و فرایند می‌توانند امضا بکشند یا عکس امضا را بگذارند.
# PDF
خروجی PDF فرم را برای پروندهٔ کاغذی دوباره چاپ می‌کند.`
  ),
  maintenanceReports: guide(
    "گزارش تعمیرات",
    `# این صفحه چیست
پروندهٔ یک سریال است: آند، کاتد یا ممبران، بسته به دکمه‌ای که زده‌اید.
# قدم‌ها
سریال را بنویسید و باز کنید. سابقهٔ تعمیر همان شماره پایین می‌آید.
اگر گزارش کاغذی دارید، PDF یا عکس را پیوست کنید. فایل پیش همان سریال می‌ماند.
# اگر سابقه خالی است
هنوز ردیف تعمیر ثبت نشده. اول در تعمیرات آند یا کاتد یا ممبران آن مراجعه را بنویسید، بعد برای چسباندن اسکن برگردید.
# برگشت
المنت‌ها شما را به منوی مدیریت المنت برمی‌گرداند.`
  ),
  storage: guide(
    "انبار",
    `# تابلو یعنی چه
هر سریال آند و کاتد در یک جا است:
روی قفسه — آخرین ردیف مونتاژش تاریخ دمونتاژ ندارد.
بیرون برای تعمیر — ردیف تعمیر باز دارد، یا به پوشش فرستاده شده.
برگشته — از پوشش آمده و منتظر بازرسی پوشش است.
سالم — قبول شده و آمادهٔ نصب است.
ناسالم — رد شده.
# روزهای در سرویس
از نصب (یا از مونتاژ، اگر نصب خالی باشد) تا دمونتاژ حساب می‌شود. اگر هنوز داخل است، تا امروز.
# دکمه‌ها
فرستادن به تعمیر یک ردیف تعمیر می‌نویسد.
ثبت برگشت و سالم / ناسالم نتیجهٔ بازرسی پوشش را می‌نویسد. همان ردیف در شش فرم الکترود دیده می‌شود.
فرستادن به پوشش یک درخواست پوشش در کارتابل باز می‌کند و به تدارکات خبر می‌دهد. بعد از آن درخواست را دنبال کنید و یک ردیف پوشش دوم را دستی ننویسید.
# بخش‌های این صفحه
نوار زیر عنوان نما را عوض می‌کند: خلاصه، موجودی، المنت‌ها، شرکت‌های پوشش، درخواست پوشش، درخواست بازرسی، خرید، سابقه، اسقاط، و خط زمان یک سریال.
# موجودی ممبران
ممبران قابل استفاده که سوار نشده. تعدادش همان چیزی است که فرم المنت جدید اجازه دارد پیشنهاد کند.
# ورود
فایل مونتاژ و دمونتاژ را اینجا یا از اطلاعات مونتاژ می‌توان وارد کرد. فایل کارگاه را بدهید.`
  ),
  cartable: guide(
    "کارتابل",
    `# این صفحه چیست
کار خود شماست، نه کل واحد. درخواست‌هایی را می‌بینید که منتظر گروه شما هستند. شمارنده یعنی چیزی منتظر است. شمارندهٔ قرمز یعنی از مهلتی که در تنظیمات گذاشته شده دیر شده.
# باز کردن کارت
روی ردیف بزنید. کارت، المنت یا سریال، سابقه، و فقط دکمه‌هایی را نشان می‌دهد که نقش شما اجازه دارد.
# درخواست‌های معمول
پوشش: تدارکات قطعه را می‌فرستد، پوشش‌دهنده برمی‌گرداند، بازرسی قبول یا رد می‌کند.
خرید: آند یا کاتد نو در شناسنامه و در موجودی ثبت می‌شود.
سل: بهره‌بردار برای سل خارج‌شده تصمیم می‌گیرد (پوزیشن جدید، یا فرستادن به C-90). C-90 دمونتاژ را ثبت می‌کند. المنت Rate off می‌شود. بعد بازرسی آند و کاتد را می‌گیرد.
بازرسی: درخواست بازرسی سل بازشده.
مونتاژ: C-90 یک آند آزاد، یک کاتد آزاد و یک نوع ممبرانِ دارای موجودی را برمی‌دارد، تاریخ مونتاژ را می‌نویسد، بازرسی مونتاژ را پر می‌کند، دو امضا را می‌گیرد، بعد الکترولایزر و پوزیشن را می‌گذارد.
دستور کار: کار نیروی انسانی روی یک المنت (صفحهٔ دستور کار).
# حذف یا لغو
دکمهٔ حذف درخواست، درخواست را لغو می‌کند و سعی می‌کند آنچه را که تا اینجا نوشته (موجودی، ردیف مونتاژ، ردیف پوشش) برگرداند. اگر مدیر سیستم هستید، یا درخواست هنوز در گام اول است و خودتان آن را ساخته‌اید، اول باید دلیل لغو را بنویسید. دکمه خاموش نمی‌شود؛ اگر دلیل خالی باشد به شما می‌گوید پرش کنید. بعد تأیید کنید. درخواست لغوشده برنمی‌گردد. سریال‌ها به حالت قبل از درخواست برمی‌گردند.
# اگر نوشت «منتظر گروه دیگر»
کارت روی گام شما نیست. می‌توانید بخوانیدش. کسی که نام گروهش آمده دکمهٔ بعدی را می‌زند.
# پیام و فایل
جایی که کارت اجازهٔ توضیح می‌دهد، بنویسید و بفرستید. پیوست، فایل را فقط به همان درخواست اضافه می‌کند.`
  ),
  processHistory: guide(
    "سابقهٔ فرایند",
    `# این فهرست چیست
هر درخواستی که در کارتابل باز شده: پوشش، خرید، سل، بازرسی، مونتاژ و دستور کار. تاریخ است، شامل تمام‌شده‌ها و لغوشده‌ها.
# جستجو
شمارهٔ درخواست، شمارهٔ المنت یا سریال را بنویسید. فهرست همان‌طور که تایپ می‌کنید تنگ می‌شود.
# فیلتر نوع
فهرست کشویی یک نوع درخواست را نگه می‌دارد. خالی یعنی همه.
# ستون‌ها
شماره، شمارهٔ درخواست است. نوع، گونهٔ کار است. المنت، سل است وقتی درخواست سل دارد. وضعیت، جایی است که متوقف شده (گام باز، تمام، لغو). کار، یک خط خلاصه است. به‌روزرسانی، آخرین تغییر است.
# باز کردن
روی ردیف بزنید. گام‌ها پایین می‌آیند: چه کسی چه کرد و کی. باز کردن درخواست به کارت زنده می‌رود اگر هنوز وجود داشته باشد.
# اینجا تاریخ را عوض نمی‌کنید
برای عوض کردن درخواست باز، کارت را باز کنید و دکمه‌های خودش را بزنید.`
  ),
  workOrders: guide(
    "دستور کار",
    `# دستور کار چیست
برگهٔ نیروی انسانی برای یک المنت. از درخواست پوشش و خرید جدا است.
# فهرست
شماره، المنت، وضعیت، و پنج نشانه: ایجاد، نصب، جمع‌آوری، انبار، دمونتاژ. نشانهٔ روشن یعنی آن مرحله ساعت یا تاریخ دارد. جستجو و فیلتر وضعیت فهرست را تنگ می‌کند. روی ردیف بزنید تا باز شود.
# جدید
جدید یک دستور خالی باز می‌کند. المنت، تاریخ‌ها و توضیح را بگذارید و ذخیره کنید. دسترسی ویرایش لازم است. دستور تمام‌شده یا لغوشده دیگر ویرایش نمی‌شود.
# داخل دستور
کارها، وظایف برنامه‌ریزی‌شده است. ردیف واقعی، ساعتی است که واقعاً کار شده، به تفکیک مرحله و نفر. یک ردیف اضافه کنید، نفر و ساعت را بنویسید و ذخیره کنید. حذف فقط همان ردیف را برمی‌دارد.
# بستن
وقتی کار تمام شد تمام‌شده علامت بزنید. اگر نباید باز می‌شد، با دلیل لغوش کنید. لغو، المنت را از اطلاعات مونتاژ پاک نمی‌کند.`
  ),
  shutdowns: guide(
    "خاموشی واحد",
    `# منو
بالای منو تریپ‌های ماه جاری و سه علتی را نشان می‌دهد که بیشتر تکرار شده‌اند. در نوار سال روی یک ماه بزنید تا ببینید آن ماه چرا خوابیده.
ورود اطلاعات (چپ): فهرست خاموشی، علت‌ها، دسته‌ها، علت تریپ.
نتایج (راست): یک بازهٔ زمانی، بعد جمع بر اساس علت و بر اساس دسته.
# فهرست خاموشی — یک ردیف
بخش واحد (یک الکترولایزر یا کل واحد)، ساعت خاموشی، ساعت راه‌اندازی، کد، علت، دسته، کیلوآمپر قبل از تریپ، توضیحات.
مدت از دو ساعت حساب می‌شود. آن را تایپ نمی‌کنید. اگر راه‌اندازی زودتر از خاموشی باشد، مدت تا وقتی ساعت را درست کنید صفر می‌ماند.
کلر از دست‌رفته و سود از دست‌رفته از کیلوآمپر ضربدر مدت حساب می‌شود و فقط‌خواندنی است.
علامت روی ردیف یعنی خاموشی و راه‌اندازی در دو ماه تقویمی با فاصلهٔ یک ماه افتاده‌اند و ساعت‌ها از مرز ماه رد شده.
# یک تریپ جدید
ردیف جدید. بخش واحد را انتخاب کنید. هر دو ساعت را بگذارید. یک کد انتخاب کنید؛ علت و دسته از فهرست علت پر می‌شود. ذخیره کنید. کد و علت اجباری است.
# ویرایش
خانه را عوض کنید و از آن بیرون بیایید، یا ذخیرهٔ همان ردیف را بزنید. خروجی، فهرست فیلترشده را می‌دهد.
# بازه
فرم بازه از شما تاریخ شروع و پایان می‌خواهد و فقط تریپ‌های داخل آن پنجره را نشان می‌دهد. فهرست ساده روی همهٔ ماه‌ها باز می‌شود.
# علت‌ها و علت تریپ
این‌ها ردیف‌های پشت فهرست کد هستند. کد، متن علت، و دسته.
برای درست کردن ردیف بد: متن را عوض کنید و ذخیره را بزنید.
برای برداشتن ردیف خالی: حذف را بزنید و تأیید کنید. اگر هم کد و هم علت را پاک کنید و ذخیره را بزنید، همان حذف است. با برگشتن به صفحه، ردیف حذف‌شده برنمی‌گردد.
ردیف را خالی نگذارید به امید اینکه ذخیره آن را نگه دارد. ردیف بدون کد پذیرفته نمی‌شود.
# دسته‌ها
نام‌هایی که ساعت‌ها با آن‌ها گروه می‌شوند (برقی، مکانیکی، فرایندی و مانند این). یک نام اضافه کنید و ذخیره کنید. تغییر نام را با احتیاط انجام دهید، چون خلاصه‌ها با همین متن گروه می‌شوند.
# خلاصه‌ها
خلاصهٔ علت، دسته و علت تریپ ساعت‌ها را جمع می‌کند. تریپ جدید نمی‌سازد. برای گزارش ماه از آن استفاده کنید و بعد خروجی بگیرید.`
  ),
  voltage: guide(
    "ولتاژ استاندارد",
    `# دو کار در این صفحه
ورود داده، اندازه‌گیری را می‌نویسد. ستون‌های پایین آن را رسم می‌کنند.
# ورود داده
الکترولایزرها: یک ردیف برای هر الکترولایزر و هر زمان. جریان کل، دمای آند، دمای کاتد، غلظت، ولتاژ کل، تعداد المنت.
همهٔ المنت‌ها: ولتاژ سل Ui همان لحظه.
گروه‌ها و تک‌المنت: جدول‌های Un، جدا از عکس الکترولایزر.
جدول الکترولایزر و سل همان جدولی است که همگام‌سازی AriaORMS پر می‌کند. ردیف دستی و ردیف همگام کنار هم‌اند. همگام‌سازی در تنظیمات، تب همگام‌سازی ولتاژ تنظیم می‌شود.
# ستون‌های گزارش
هر ستون یک محدوده است: کل واحد، ترین، الکترولایزر، گروه‌ها، یا المنت‌ها.
مبنا را انتخاب کنید، یک واحد یا چند واحد، و نمودار یا جدول. بعد دکمهٔ نمایش همان ستون را بزنید. تصویر از تاریخ شروع و پایان بالای صفحه استفاده می‌کند.
چندتایی جعبه‌ای باز می‌کند که در آن بیش از یک الکترولایزر، گروه یا سل را علامت می‌زنید.
# Un را چطور بخوانید
Un ولتاژ استاندارد است، اصلاح‌شده به سمت چگالی جریان مرجع و ضریب دما و غلظت از تنظیمات. خودِ Ui خام نیست.
# خروجی و دسترسی
جایی که برگه اکسل یا PDF دارد، همان برگه را می‌دهد. عوض کردن یک اندازه‌گیری به دسترسی ویرایش ولتاژ نیاز دارد.`
  ),
  currentEfficiency: guide(
    "راندمان جریان",
    `# ورود داده
راندمان از تولید سود: یک فرم برای کل واحد، ترین، الکترولایزر، گروه و المنت. تاریخ و درصد راندمان را وارد می‌کنید. فرم ترین، الکترولایزر، گروه و المنت همچنین می‌پرسد کدام واحد.
# گزارش
هر ستون می‌تواند از موازنهٔ آندی یا از تولید سود استفاده کند، برای یک واحد یا چند واحد، به صورت نمودار یا جدول. شروع و پایان را بگذارید، بعد نمایش را بزنید.
# برگهٔ کاتدی
دکمهٔ ترین، برگهٔ راندمان کاتدی را باز می‌کند: یک روز، یک ترین، جدول سل‌ها. خانه‌هایی را که دارید پر کنید تا برگه حساب کند. خانه‌های اجباری خالی فهرست می‌شوند تا ببینید چه چیزی جا مانده.
# راهنمای فرمول
دکمهٔ فرمول، عبارتی را که برنامه استفاده می‌کند می‌نویسد. قبل از مقایسه با حساب دستی آن را بخوانید.
# احتیاط
راندمان از دادهٔ بهره‌برداری فقط وقتی معنی دارد که جریان، ولتاژ و آنالیز آزمایشگاه مال همان روز باشند. برنامه نمونهٔ جاافتاده را اختراع نمی‌کند.`
  ),
  cathodicCe: guide(
    "برگهٔ راندمان کاتدی",
    `# چه می‌بینید
یک روز و یک ترین. جدول، محاسبهٔ راندمان کاتدی همان ترین است.
# پر کردن
روز را بگذارید. خانه‌های اندازه‌گیری‌شده را وارد کنید. خانه‌های محاسبه‌شده خودشان پر می‌شوند و نمی‌شود در آن‌ها تایپ کرد.
# جاافتاده‌ها
اگر برگه را شروع کرده باشید، خط زیر جدول هر کدی را که هنوز خالی است نام می‌برد (به‌جز ردیف‌های غلظت). آن‌ها را پر کنید و بعد نتیجه را بخوانید.
# ذخیره
بیرون آمدن از خانهٔ تایپ‌شده، هنگام ذخیرهٔ برگه آن را نگه می‌دارد. پیوند برگشت به منوی راندمان جریان برمی‌گردد. این برگه اطلاعات مونتاژ را عوض نمی‌کند.`
  ),
  powerConsumption: guide(
    "مصرف انرژی",
    `# این عدد چیست
انرژی ویژهٔ محدودهٔ انتخاب‌شده بین تاریخ شروع و پایان. ستون‌ها کل واحد، ترین، الکترولایزر، گروه و المنت هستند.
# قبل از رسم
تاریخ‌ها را بگذارید. در ستون، نمودار یا جدول را انتخاب کنید و برای محدوده‌های کوچک‌تر یک واحد یا چند واحد را انتخاب کنید. ستون الکترولایزر و گروه همچنین می‌پرسد کدام جدول ولتاژ و کدام مبنا (آندی یا سود) استفاده شود.
# نمایش
دکمهٔ همان ستون را بزنید. تاریخ را عوض کنید و دوباره بزنید. تصویر قبلی تا آن لحظه می‌ماند.
# اگر نمودار خالی است
در آن پنجره برای آن واحد، ولتاژ استاندارد و راندمان وجود ندارد. اول آن‌ها را وارد کنید، یا تاریخ را بازتر کنید.`
  ),
  unCe: guide(
    "Un / CE",
    `# این صفحه چه را کنار هم می‌گذارد
برای همان الکترولایزر و همان روز: ولتاژ استاندارد Un، راندمان جریان، و انرژی ویژه. انرژی ویژه برابر است با Un ضربدر ۱۰۰۰۰۰ تقسیم بر (۱٫۴۹۲۳ ضربدر راندمان)، همان عبارت پرس‌وجوهای اکسس.
# انتخاب‌ها
تاریخ شروع و پایان. یک الکترولایزر، یا کل واحد. کدام جدول Un. راندمان از موازنهٔ آندی یا از تولید سود. نمودار یا جدول.
# نمایش
بعد از انتخاب‌ها دکمهٔ واحد یا دکمهٔ الکترولایزر را بزنید. ستون‌های جدول: الکترولایزر، تاریخ، چگالی جریان، Un، راندمان، انرژی و چگالی جریان مرجع.
# تنظیم
جعبهٔ کوچک تنظیم روی صفحه، مرجع همان محاسبه است. ضریب‌های کل واحد هنوز در تنظیمات‌اند.
# اگر یک روز جا افتاده
آن روز ولتاژ دارد و راندمان ندارد، یا برعکس. ردیف نیمهٔ جاافتاده را نمی‌سازد.`
  ),
  testRunResults: guide(
    "نتایج تست ران",
    `# یک ردیف چیست
یک آزمون عملکرد: تاریخ، بخش واحد، درصد راندمان و انرژی ویژه. نام واحد، خط نمک یا پتاس، و UAN بالای صفحه از تنظیمات می‌آید.
# افزودن
ردیف جدید را به کار ببرید. تاریخ و بخش واحد آزمون را مشخص می‌کنند. راندمان و انرژی ویژه را عدد بنویسید. ذخیره کنید.
# ویرایش
روی ردیف بزنید، خانه را عوض کنید و ذخیره کنید. دسترسی ویرایش ولتاژ لازم است. فقط‌مشاهده می‌تواند بخواند و خروجی بگیرد.
# فیلتر
سرستون هر ستون برگه را فیلتر می‌کند. خروجی، ردیف‌هایی را می‌دهد که می‌بینید.
# این فرم راندمان روزانه نیست
راندمان روزانه مال صفحهٔ راندمان جریان است. این برگه فقط سابقهٔ رسمی تست ران است.`
  ),
  plantCharts: guide(
    "نمودارهای واحد",
    `# خط‌ها چیست
ولتاژ، جریان (کیلوآمپر) و توان (کیلووات) روی یک محور زمان، برای کل واحد، یک ترین، یا یک الکترولایزر.
# بازه
۱۰، ۳۰ یا ۹۰ روز اخیر، یک سال، دو سال، یا شروع و پایانی که خودتان می‌نویسید.
# علامت‌ها
هر خط را روشن یا خاموش کنید. خطی که در آن پنجره اندازه‌گیری ندارد خالی می‌ماند. این صفر نیست.
# خواندن یک نقطه
روی نمودار بایستید. تاریخ و سه مقدار می‌آید. این‌ها عکس‌های ذخیره‌شدهٔ بهره‌برداری است، نه پیش‌بینی.`
  ),
  analyses: guide(
    "آنالیز",
    `# منو
پنج ستون: کل واحد، ترین، الکترولایزر، گروه، المنت. هر دکمه یک نوع نمونه است. جای خالی در یک ستون یعنی آن نمونه در آن سطح گرفته نمی‌شود (مثلاً گروه دکمهٔ هیدروژن ندارد).
# نوع نمونه‌ها
آنولیت، کاتولیت، اسید کلریدریک، آب‌نمک خالص، کلر، هیدروژن، آب دمین، سود رقیق. آب‌نمک خالص روی فرم دو ستون است: نمک‌ها چپ، فلزات ناچیز راست. فرم‌های دیگر فقط مقدار و واحد خودشان را نشان می‌دهند.
# فرم چه می‌پرسد
کل واحد: تاریخ و ساعت. ترین، شمارهٔ ترین را هم می‌خواهد. الکترولایزر، الکترولایزر را. گروه، گروه را. المنت، الکترولایزر و پوزیشن را.
# نمای فرم و نمای جدول
نمای فرم یک نمونه را ویرایش می‌کند. نمای جدول فهرست است. ذخیره همان نمونه را نگه می‌دارد. ذخیره و بعدی، همان الکترولایزر و تاریخ و ساعت را نگه می‌دارد و فرم دیگر همان سطح را باز می‌کند.
# ورود
مدیر سیستم می‌تواند از این منو یک فایل را وارد کند. خط پیشرفت را بخوانید. ورود دوبارهٔ همان فایل دو بار نمی‌پرسد؛ تعداد نتیجه را چک کنید.
# دکمهٔ راندمان جریان
به منوی راندمان می‌رود، چون راندمان از همین نمونه‌ها به‌اضافهٔ جریان حساب می‌شود.
# خروجی
در بخش باز، اکسل یا PDF فقط همان بخش را می‌دهد.`
  ),
  statistics: guide(
    "آمار",
    `# ولتاژ تک‌المنت
اول الکترولایزر را انتخاب کنید. سه دکمه بعد فقط همان الکترولایزر را باز می‌کنند.
ولتاژ المنت‌ها: Un هر سل.
ولتاژهای بالا: سل‌هایی که بالای خط ولتاژ بالا نشسته‌اند.
توزیع Un: چند سل در هر کلاس ولتاژ می‌افتد. حد کلاس‌ها در تنظیمات، کلاس‌های ولتاژ است. بعد از عوض کردن تاریخ، به‌روزرسانی نمایش را بزنید.
# مصرف انرژی
مقایسهٔ انرژی ویژهٔ الکترولایزرها را داخل همین دفتر آمار باز می‌کند.
# ممبران
DOL روزهای در سرویس به تفکیک نوع ممبران است: هر نوع چقدر کار کرده. گزارش است، ویرایشگر نیست.
# گروه‌ها
سه گزارش: میانگین گروه بر اساس تاریخ، مقدار گروه بر اساس تاریخ، و میانگین بر اساس الکترولایزر و تاریخ.
# به‌روزرسانی نمایش
در فرمی که این دکمه را دارد، تصویر تا وقتی نزنیدش تکان نمی‌خورد.
# خروجی
جایی که برگه اکسل یا PDF دارد، جدولی را که می‌بینید بیرون می‌دهد.`
  ),
  reports: guide(
    "گزارش و تحلیل",
    `# این صفحه چه جمع می‌کند
یک بسته برای مرور مدیریت: میانگین ولتاژ و نقاط بیرون‌زده، ساعت خاموشی به تفکیک دسته، رقم راندمان، و روزهای در سرویس.
# فیلتر
جعبهٔ الکترولایزر بسته را به یک الکترولایزر محدود می‌کند. خالی یعنی کل واحد. نمودارهای زیر، الگوی ماهانهٔ ولتاژ و خاموشی همان فیلتر را نشان می‌دهند.
# خروجی
اکسل یا PDF بسته‌ای را که نگاه می‌کنید می‌سازد. برای جلسه به کار می‌رود. عوض کردن عدد در فرم اصلی انجام می‌شود (ولتاژ، خاموشی، راندمان)، نه اینجا.`
  ),
  search: guide(
    "جستجو",
    `# دو راه
دکمه‌ها منوی جستجوی اصلی را تکرار می‌کنند. جعبهٔ بالای آن‌ها در کل برنامه می‌گردد.
# دکمه‌هایی که یک کلمه می‌خواهند
المنت، آند، کاتد، ممبران، الکترولایزر، گروه، یادداشت، نوع ممبران، پوشش. دکمه را بزنید، متن را بنویسید، تأیید کنید. اگر سریال کامل را مطمئن نیستید، تکه‌ای از آن کافی است.
# دکمه‌هایی که فوری اجرا می‌شوند
المنت فعال، المنت غیرفعال، روزهای در سرویس، فهرست DOL، تکراری‌ها (یک سریال روی دو ردیف)، موجودی، گروه‌های فعال.
# دکمه‌هایی که تاریخ می‌خواهند
مونتاژ، راه‌اندازی، خروج از سرویس، دمونتاژ. المنت‌هایی را می‌گیرید که همان تاریخ‌شان مطابق است.
# نتیجه
جدولی زیر دکمه‌ها باز می‌شود. روی ردیف بزنید تا به آن المنت یا سریال بروید. اگر جدول خالی است چیزی مطابق نبوده؛ کلمه را کوتاه‌تر کنید.
# تکراری‌ها
جستجوی تکراری راه پیدا کردن یک آند است که روی دو المنت زنده تایپ شده. ردیف غلط را در اطلاعات مونتاژ درست کنید. این صفحه ویرایش نمی‌کند.`
  ),
  arrangement: guide(
    "چیدمان سل",
    `# تابلو
همهٔ پوزیشن‌های الکترولایزری که انتخاب کرده‌اید. سل پر، المنتی را نشان می‌دهد که همین حالا آنجاست. سل خالی المنت جاری ندارد.
# کلیک روی سل
پانل کناری همان پوزیشن است: نصب، و آند، کاتد، ممبران، بازرسی‌ها، نقشهٔ نیم‌پوسته، ولتاژ و راندمان متعلق به آن. با شمارهٔ المنت و پوزیشن به هم بسته‌اند.
# ویرایش
نصب را از پانل عوض کنید یا یکی تازه شروع کنید، بعد ذخیره کنید. به‌روزرسانی نمایش را بزنید تا تابلو دوباره کشیده شود. اگر المنت جدید را نمی‌بینید، هنوز نمایش را تازه نکرده‌اید.
# بلوک‌ها
کدام پوزیشن مال کدام بلوک است در تنظیمات، تب چیدمان است، نه روی این تابلو.
# دو المنت در یک سل
تابلو نصب جاری را نشان می‌دهد. اگر داشبورد المنت تعارض گزارش کرد، دو ردیف در اطلاعات مونتاژ یک پوزیشن را ادعا می‌کنند. ردیف واقعی را نگه دارید و آن یکی را خالی کنید.`
  ),
  remarks: guide(
    "یادداشت‌ها",
    `# یک ردیف چیست
یادداشت تاریخ‌دار که جای فرم مشخصی ندارد: یک تماس، یک مسیر موقت، یک یادآوری.
# ستون‌ها
شماره را برنامه می‌دهد. تاریخ، روز یادداشت است. یادداشت، متن است.
# افزودن و ویرایش
ردیف جدید، تاریخ و متن را بنویسید، ذخیره کنید. روی ردیف موجود بزنید تا عوض شود. حذف فقط همان یادداشت را برمی‌دارد.
# فیلتر و خروجی
سرستون هر ستون می‌تواند فیلتر کند. اکسل یا PDF یادداشت‌هایی را می‌دهد که می‌بینید.
# دسترسی
برای ذخیره، دسترسی ویرایش یادداشت لازم است. دسترسی مشاهده می‌تواند بخواند و خروجی بگیرد.`
  ),
  settings: guide(
    "تنظیمات",
    `# واحد
نام مشتری، UAN، نوع واحد (سود یا پتاس)، اسیدی کردن، چگالی جریان مرجع و ثابت ولتاژ صفر. این‌ها سربرگ‌ها و محاسبهٔ Un را تغذیه می‌کنند. قبل از ترک تب، ذخیره را بزنید.
# فهرست نام‌ها
الکترولایزرها، زیرواحدها، واحدهای کامل، یکسوکننده‌ها، ترانسفورماتورها. شماره به‌اضافهٔ نام. نام الکترولایزرها همان‌هایی است که هر فهرست انتخاب در برنامه پیشنهاد می‌کند. اتاق سل جدید را اینجا اضافه کنید، قبل از اینکه بخواهید روی یک فرم تایپش کنید.
# چیدمان‌ها
یک بلوک: نام، زیرواحد، ترانسفورماتور، یکسوکننده، پوزیشن شروع، پوزیشن پایان. چیدمان سل از این برای کشیدن تابلو استفاده می‌کند.
# پوزیشن ذخیره
پوزیشن‌هایی که یدکی‌اند، نه سل در حال کار.
# ضرایب تصحیح و سطح الکترود
تصحیح دما و غلظت، و متر مربع یک الکترود. Un و چگالی جریان از این‌ها استفاده می‌کنند. برای «درست شدن ظاهر نمودار» عوضشان نکنید.
# کلاس‌های ولتاژ
سطل‌های نمودار توزیع Un: یک برچسب، حد پایین، حد بالا.
# گروه‌ها
کدام پوزیشن‌های المنت گروه ۱ و گروه ۲ و بقیه را می‌سازند.
# دلایل و یافته‌های بازرسی
کدهایی که فرم بازرسی پیشنهاد می‌کند. انتخاب پیش‌فرض، هنگام باز شدن گزارش تازه آن خط را علامت می‌زند. تعداد نشان می‌دهد چند گزارش تا حالا از آن استفاده کرده‌اند.
# فهرست فیلدها
هر فهرست کشویی برنامه (نوع ممبران، سازنده، پوشش و بقیه). تغییر نام، ادغام یا حذف در همهٔ فرم‌ها و همهٔ رکوردهای قدیمی که آن کلمه را داشتند نوشته می‌شود. نوع ممبران اینجا همان نام‌های موجودی ممبران است.
# ظاهر
فرم‌ها به صورت جدول باز شوند یا به صورت یک رکورد. جدول امن‌تر است: روی همان ردیفی که منظور دارید دو بار کلیک می‌کنید.
# حداقل نیازها
مشخصات رایانه و سروری که برنامه انتظار دارد. رایانهٔ شما را آزمایش نمی‌کند. فهرست است برای کسی که دستگاه را نصب می‌کند.
# ورود و خروج داده
برای کاربر مجاز: آوردن یک فایل یا استخراج اکسس، یا فرستادن داده به بیرون. خط پیشرفت را بخوانید. ورود طبق انتخاب همان تب جایگزین یا اضافه می‌کند. دکمهٔ برگشت نیست.
# مهلت کارتابل
چند ساعت یک درخواست می‌تواند روی یک گام بماند تا کارتابل آن را دیرشده علامت بزند.
# شغل‌های برنامه‌ریز
کارهای زمان‌بندی‌شده‌ای که سرور اجرا می‌کند. دست نزنید مگر به شما گفته باشند ساعتی را عوض کنید.
# پشتیبان
یک کپی از پایگاه داده بگیرید. قبل از ورود بزرگ این کار را بکنید.
# همگام‌سازی ولتاژ و AriaLIMS
نشانی و کلید کشیدن خودکار. نشانی غلط ردیف تازه را متوقف می‌کند. ردیف‌های قدیمی را پاک نمی‌کند.
# فایل جدول‌ها
فقط مدیر سیستم. هر جدول، فایل اکسلی که آخرین بار بار شده، حجمش، و تعداد ردیف. حذف، فایل و ردیف‌ها را برمی‌دارد. بارگذاری، کل جدول را جایگزین می‌کند.
# پایگاه داده
فقط مدیر سیستم. فایل پایگاه کجاست، دریافت آن، یا اشارهٔ برنامه به سرور دیگر. فقط وقتی واحد متوقف است و پشتیبان در دست دارید.
# اکتیو دایرکتوری
فقط مدیر سیستم. ورود را به دامنهٔ ویندوز می‌بندد تا فقط کاربران فهرست‌شده یا یک گروه دامنه برنامه را باز کنند.
# دسترسی
بیشتر تب‌ها ویرایش تنظیمات می‌خواهند. بازدیدکننده می‌تواند نگاه کند. کاربران، گزارش‌ها، پایگاه و دایرکتوری مخصوص مدیر سیستم است.`
  ),
  users: guide(
    "کاربران و نقش‌ها",
    `# چه کسی این صفحه را باز می‌کند
فقط مدیر سیستم. بقیه برگردانده می‌شوند.
# تب کاربران
فرد را بسازید: نام کاربری، نام کامل، رمز. سطح دسترسی مدیر، کاربر یا بازدیدکننده است. مدیر می‌تواند کاربران و گزارش ممیزی را باز کند. بازدیدکننده نگاه می‌کند و ذخیره نمی‌کند. کاربر، بهره‌بردار معمولی است.
یک نقش آماده بدهید، یا برای همین یک نفر جدول دسترسی جدا بسازید. هنگام ویرایش اگر می‌خواهید رمز فعلی بماند، رمز را خالی بگذارید.
# تب نقش‌ها
نقش، ستون آمادهٔ دسترسی است. برای هر منو: هیچ، آن را کامل پنهان می‌کند (منوی اصلی، نوار کناری و همهٔ فرم‌ها). مشاهده می‌تواند بخواند و خروجی بگیرد. ویرایش می‌تواند ذخیره کند.
نقش آمادهٔ بازرس، ولتاژ و پایش را نشان می‌دهد و بقیه را پنهان می‌کند. اگر شغل مشابه می‌خواهید از آن کپی بگیرید.
# کسی که دکمه‌ای را نمی‌بیند
نقشش روی آن بخش «هیچ» است. نقش را عوض کنید، یا روی خود کاربر جدول جدا بگذارید. باید خارج شود و دوباره وارد شود.
# یک ورود را شریک نشوید
گزارش ممیزی نام کاربری را ثبت می‌کند. رمز مشترک، سابقه را بی‌مصرف می‌کند.`
  ),
  logs: guide(
    "گزارش ممیزی",
    `# چه کسی این صفحه را باز می‌کند
فقط مدیر سیستم.
# چه ثبت می‌شود
هر ورود، موفق یا ناموفق. هر عوض شدن رمز. هر ذخیره، تغییر و حذف، با نام کاربر، نشانی رایانه، زمان، فرم، و مقدار قبلی و جدید.
رمز و توکن به صورت خالی ذخیره می‌شود. اینجا نمی‌بینیدشان.
# خواندن ردیف
روی آن بزنید. جزئیات هر فیلدی را که عوض شده فهرست می‌کند.
# فیلتر و خروجی
با کاربر یا تاریخ تنگ کنید، بعد اگر باید فهرست را به کسی بدهید اکسل یا PDF بگیرید.
# این صفحه برنمی‌گرداند
برای برگرداندن یک مقدار، فرم اصلی را باز کنید و دوباره تایپ کنید. گزارش فقط ثابت می‌کند چه کسی عوض کرده.`
  ),
  activity: guide(
    "فعالیت کار",
    `# این صفحه چیست
بین دو تاریخ چه کسی چه کرد. رد ممیزی را می‌خواند و طوری گروه می‌کند که سرپرست کارگاه، انبار، آزمایشگاه و بازرسی را ببیند بدون باز کردن گزارش خام.
# فیلترها
از، تا، یک نقش، و یک نام کاربری. تازه‌سازی دوباره می‌خواند. کارت‌ها و تب‌ها همه از همین پنجره استفاده می‌کنند.
# خلاصه
تعداد به تفکیک نفر و نوع کار. روی یک نفر بزنید تا فهرست کارهایش بیاید.
# رویدادها
خط‌های خام: زمان، کاربر، چه عوض شد. خروجی اکسل همین فهرست را می‌دهد.
# کارگاه سل، انبار، آزمایشگاه، بازرسی
همان پنجره، جدا شده بر اساس محل کار. بازرسی هم گزارش بازرسی را دارد هم گزارش بازرسی مونتاژ را.
# خالی
هیچ فعالیتی در این دوره یعنی بین آن تاریخ‌ها کسی ردیفی ذخیره نکرده. قبل از اینکه فکر کنید کسی کار نکرده، تاریخ را بازتر کنید.`
  ),
  tickets: guide(
    "تیکت‌ها",
    `# تیکت چیست
پیام به مدیر سیستم: یک عدد غلط، یک دسترسی جاافتاده، یک خرابی برنامه. هر کسی که وارد شده این صفحه را باز می‌کند، هر نقشی که داشته باشد.
# نوشتن
تیکت جدید. یک عنوان کوتاه، بعد شرح: کدام صفحه، کدام المنت یا سریال، چه انتظاری داشتید، چه شد. بفرستید.
# رشتهٔ گفتگو
تیکت خودتان را باز کنید تا جواب را بخوانید. در همان تیکت جواب بدهید. برای همان مشکل تیکت دوم باز نکنید.
# عدد روی منو
تعداد جواب‌هایی است که هنوز باز نکرده‌اید. تیکت را باز کنید تا پاک شود.
# تیکت چه نمی‌کند
داده را عوض نمی‌کند و خودش دسترسی نمی‌دهد. مدیر سیستم آن کار را در کاربران یا روی فرم انجام می‌دهد.`
  ),
  monitoring: guide(
    "پایش و هشدار",
    `# نمای کلی
آخرین تصویر الکترولایزرها: ولتاژ، جریان، و شمارش‌هایی که ارزش نگاه دارند. حدود هر یک دقیقه تازه می‌شود. جای تایپ اندازه‌گیری نیست.
# سلامت سل
تابلوی همهٔ سل‌ها. رنگ، سل‌هایی را نشان می‌دهد که قاعده‌ها خارج از حد می‌دانند. اگر ردیف مونتاژ را لازم دارید به المنت بروید.
# هشدارها
صندوق هشدارهای باز (ولتاژ بالای سل، نمونهٔ جاافتاده، درخواست دیرشده). یکی را باز کنید، بخوانید چرا آمده، و وقتی وضع واحد تمام شد ببندیدش. بستن هشدار سل را درست نمی‌کند.
# قاعده‌ها
کدام حدها هشدار می‌سازند و به چه کسی گفته می‌شود. حد را فقط وقتی عوض کنید که واحد روی عدد جدید توافق کرده باشد. حد صفر ممکن است تمام روز فریاد بزند یا هیچ‌وقت نزند. قبل از ذخیره برچسب را بخوانید.
# دسترسی
بینندهٔ ولتاژ می‌تواند نمای کلی را باز کند. عوض کردن قاعده به دسترسی ویرایش همان بخش نیاز دارد.`
  ),
  about: guide(
    "درباره",
    `# کارت
نام برنامه، واحد، و نسخه. نسخه باید با چیزی که مدیر آخرین بار نصب کرده یکی باشد. اگر منو نسخهٔ قدیمی‌تر از چیزی نشان می‌دهد که به شما گفته‌اند، سرور هنوز به‌روز نشده.
# اعتماد
ورود لازم است. هر کس فقط منوهای نقش خودش را می‌بیند. پایگاه داده روی سرور واحد می‌ماند. برنامه ردیف‌های شما را به سرویس بیرون نمی‌فرستد. ذخیره‌ها در گزارش ممیزی نوشته می‌شود.
# سندها
مجوز، توافق کاربر، شرایط استفاده، حریم خصوصی و امنیت. هر کارت آن متن را باز می‌کند. بخوانیدشان. قاعدهٔ استفاده از همین نسخه است.
# این صفحه چیزی را عوض نمی‌کند
اینجا ذخیره ندارد.`
  ),
  allTables: guide(
    "همهٔ فرم‌ها و جدول‌ها",
    `# گروه‌ها چیست
هر فرمی که اجازه دارید ببینید، در گروه‌ها: المنت‌ها، قطعات، بهره‌برداری، تنظیمات، سیستم. فرمی که نقش شما پنهان می‌کند اینجا هم نمی‌آید.
# پیش‌نمایش
روی نام بزنید. تازه‌ترین ردیف‌ها پایین باز می‌شود. دوباره بزنید تا بسته شود.
# خروجی و باز کردن
هر پیش‌نمایش اکسل و PDF خودش را دارد. باز کردن فرم به صفحهٔ واقعی می‌رود، جایی که می‌توانید فیلتر کنید و اگر نقش اجازه بدهد ویرایش کنید.
# وقتی گم شده‌اید
اگر داده را می‌شناسید ولی دکمهٔ منو را نه، نام جدول را اینجا پیدا کنید.`
  ),
  databaseTables: guide(
    "همهٔ جدول‌ها",
    `# این فهرست چیست
جدول‌های اصلی پایگاه، از جمله آن‌هایی که فرم خوش‌ظاهر ندارند.
# پیدا کردن
با نام جدول یا نام یک ستون بگردید. بعد فقط یک دسته را نگه دارید، یا جدول‌های خالی را پنهان کنید.
# داخل جدول
پیش‌نمایش، جستجو، فیلتر، و اگر دسترسی ویرایش دارید افزودن، عوض کردن یا حذف ردیف. خروجی اکسل یا PDF.
# مراقب باشید
این جدول‌ها انبار داده‌اند، نه گزارش. حذف ردیف اینجا، آن را از هر گزارشی که می‌خواندش هم برمی‌دارد. وقتی فرم معمولی وجود دارد، همان را ترجیح دهید.`
  ),
  elementReport: guide(
    "گزارش و داشبورد المنت",
    `# این دکمه راهنمای تصویری را باز می‌کند
علامت سؤال روی گزارش المنت و روی داشبورد المنت، راهنمای کامل را باز می‌کند: عددها از کجا می‌آیند، عمر یک المنت، هر تب، هر فیلد، جدول‌ها چطور به هم وصل می‌شوند، و کار یک روز معمولی.
# به این ترتیب بخوانید
این چیست. کجا پیدا می‌شود. چرخهٔ عمر. گزارش کوچک منوی اصلی. تب‌ها. فیلدها. ارتباط جدول‌ها. شش کار روزانه. هشدارهای آخر.
# نسخهٔ کوتاه
در سرویس یعنی المنت در حال کار است. بعد از دمونتاژ Rate off است و برنمی‌گردد. عمر پوشش از آخرین برگشت حساب می‌شود، نه از روزی که فلز نو بوده. مرحلهٔ دستی کارگاه فقط تا وقتی می‌ماند که تاریخ مونتاژ جدیدتری ذخیره شود.`
  ),
};
