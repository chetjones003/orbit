# Orbit installer hooks. electron-builder's own upgrade step only removes the install registered under
# this app's uninstall key for the chosen scope. An install in another folder, or one made for all
# users, is left behind. Before the new version goes in, every Orbit install found under either scope
# is uninstalled, and its folder removed when nothing else is left in it.
#
# An entry counts as Orbit when its DisplayName and Publisher match the values electron-builder wrote
# (electron-builder.yml productName, and the author in package.json).

# The uninstaller is built from the same script, so the install-only code is left out of it.
!ifndef BUILD_UNINSTALLER

!define ORBIT_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall"
!define ORBIT_DISPLAY_NAME "Orbit"
!define ORBIT_PUBLISHER "Chet Jones"
!define ORBIT_UNINSTALLER_FILE "Uninstall Orbit.exe"

# Defines one scan of an uninstall root. Enumeration restarts after each removal, because removing a key
# shifts the entries after it.
!macro ORBIT_DEFINE_SCAN NAME ROOT SCOPE
  Function ${NAME}
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    Push $R5
    Push $R6
    Push $R7

    StrCpy $R1 0

    ${NAME}_Next:
      EnumRegKey $R2 ${ROOT} "${ORBIT_UNINSTALL_KEY}" $R1
      StrCmp $R2 "" ${NAME}_Done

      ReadRegStr $R3 ${ROOT} "${ORBIT_UNINSTALL_KEY}\$R2" DisplayName
      StrCmp $R3 "${ORBIT_DISPLAY_NAME}" 0 ${NAME}_Skip
      ReadRegStr $R4 ${ROOT} "${ORBIT_UNINSTALL_KEY}\$R2" Publisher
      StrCmp $R4 "${ORBIT_PUBLISHER}" 0 ${NAME}_Skip

      ReadRegStr $R6 ${ROOT} "${ORBIT_UNINSTALL_KEY}\$R2" InstallLocation
      StrCmp $R6 "" ${NAME}_Skip
      IfFileExists "$R6\${ORBIT_UNINSTALLER_FILE}" 0 ${NAME}_Skip

      # The uninstaller runs from a copy outside the folder it deletes, as electron-builder's own upgrade does.
      InitPluginsDir
      CopyFiles /SILENT "$R6\${ORBIT_UNINSTALLER_FILE}" "$PLUGINSDIR\orbit-old-uninstaller.exe"
      ExecWait '"$PLUGINSDIR\orbit-old-uninstaller.exe" /S /KEEP_APP_DATA ${SCOPE} _?=$R6' $R7

      StrCmp $R7 0 ${NAME}_Removed 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "Orbit could not remove the earlier install in $R6. Remove it from Apps & features, then run this installer again." /SD IDOK
        Quit
      ${NAME}_Removed:

      # The uninstaller leaves its own file behind when run in place. Remove it, then the folder if it is empty.
      Delete "$R6\${ORBIT_UNINSTALLER_FILE}"
      RMDir "$R6"

      # Restart the scan only when the entry is gone. A stubborn one is skipped so the scan cannot loop.
      ReadRegStr $R3 ${ROOT} "${ORBIT_UNINSTALL_KEY}\$R2" DisplayName
      StrCmp $R3 "" 0 ${NAME}_Skip
      StrCpy $R1 0
      Goto ${NAME}_Next

    ${NAME}_Skip:
      IntOp $R1 $R1 + 1
      Goto ${NAME}_Next

    ${NAME}_Done:
      Pop $R7
      Pop $R6
      Pop $R5
      Pop $R4
      Pop $R3
      Pop $R2
      Pop $R1
      Pop $R0
  FunctionEnd
!macroend

!insertmacro ORBIT_DEFINE_SCAN orbitScanCurrentUser HKEY_CURRENT_USER /currentuser
!insertmacro ORBIT_DEFINE_SCAN orbitScanAllUsers HKEY_LOCAL_MACHINE /allusers

Function orbitRemovePriorInstalls
  Call orbitScanCurrentUser
  Call orbitScanAllUsers
FunctionEnd

# Clean slate: before the new version is written, the file type and app registrations left by earlier
# installs are removed (see clear-orbit-registrations.ps1). The new install then registers its own.
Function orbitClearRegistrations
  InitPluginsDir
  File /oname=$PLUGINSDIR\clear-orbit-registrations.ps1 "${BUILD_RESOURCES_DIR}\clear-orbit-registrations.ps1"
  nsExec::Exec 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\clear-orbit-registrations.ps1"'
  Pop $R0
FunctionEnd

!macro customInit
  Call orbitRemovePriorInstalls
  Call orbitClearRegistrations
!macroend

# Runs after the new files and registrations are written. Taskbar pins from earlier installs are pointed
# at the new exe, and the shell is told that associations and icons changed, so Explorer redraws them.
!macro customInstall
  File /oname=$PLUGINSDIR\repoint-pins.ps1 "${BUILD_RESOURCES_DIR}\repoint-pins.ps1"
  nsExec::Exec 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\repoint-pins.ps1" -Exe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  Pop $R0
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
  nsExec::Exec 'ie4uinit.exe -ClearIconCache'
  Pop $R0
!macroend

!endif
