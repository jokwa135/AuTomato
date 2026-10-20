Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
Name "AuTomato"
OutFile "..\dist\installers\AuTomato-0.3.2-Windows-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\AuTomato"
InstallDirRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AuTomato" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "assets\installer-icons\icon.ico"
UninstallIcon "assets\installer-icons\icon.ico"
BrandingText "AuTomato | Local creative workspace"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_DIRECTORYPAGE_TEXT_TOP "Choose where to install AuTomato. You can choose a separate folder for sessions and assets on first launch."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  SetOutPath "$TEMP"
FunctionEnd

Section "AuTomato"
  SetOutPath "$INSTDIR"
  File /r "..\dist\installers\build\win-unpacked\*.*"
  WriteUninstaller "$INSTDIR\Uninstall AuTomato.exe"
  FileOpen $0 "$INSTDIR\Start AuTomato.cmd" w
  FileWrite $0 '@echo off$\r$\nsetlocal$\r$\nset ELECTRON_RUN_AS_NODE=$\r$\nstart "AuTomato" "%~dp0AuTomato.exe"$\r$\n'
  FileClose $0
  FileOpen $0 "$INSTDIR\Uninstall AuTomato.cmd" w
  FileWrite $0 '@echo off$\r$\nsetlocal$\r$\n"%~dp0Uninstall AuTomato.exe"$\r$\n'
  FileClose $0
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AuTomato" "DisplayName" "AuTomato"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AuTomato" "DisplayVersion" "0.3.2"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AuTomato" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AuTomato" "DisplayIcon" "$INSTDIR\AuTomato.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AuTomato" "UninstallString" '"$SYSDIR\cmd.exe" /d /c ""$INSTDIR\Uninstall AuTomato.cmd""'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AuTomato" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AuTomato" "NoRepair" 1
SectionEnd

Section "Uninstall"
  # Preserve application files and all user profiles instead of deleting them.
  ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
  System::Call 'kernel32::GetCurrentProcessId() i .r7'
  ${GetParent} "$INSTDIR" $9
  StrCpy $8 "$9\AuTomato-backup-$2$1$0-$4$5$6-$7"
  SetOutPath "$9"
  ClearErrors
  Rename "$INSTDIR" "$8"
  ${If} ${Errors}
    MessageBox MB_ICONSTOP "Close AuTomato and try again. Application files were not removed."
    Abort
  ${EndIf}
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AuTomato"
SectionEnd
