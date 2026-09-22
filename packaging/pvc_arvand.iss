#define MyAppName "PVC Arvand"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Arvand Petrochemical Company"
#define MyAppExeName "PVCArvand.exe"
#define MyAppURL "http://127.0.0.1:8080/"

[Setup]
AppId={{8F3C2A91-0D47-4E6B-9B1A-A1B2C3D4E5F6}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\PVC Arvand
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=PVCArvand-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=pvc-arvand.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "..\backend\dist\PVCArvand\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch PVC Arvand now"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Keep plant data in %LOCALAPPDATA%\PVCArvand (database, backups, JWT secret).
; Only remove the installed program files.
Type: filesandordirs; Name: "{app}"
