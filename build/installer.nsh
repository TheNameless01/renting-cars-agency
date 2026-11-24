; Custom NSIS Installer & Uninstaller Hooks for Gestion Agence de Location
; Guarantees that agency SQLite databases, encrypted vault files, and local backups
; under %APPDATA% are NEVER deleted during application upgrades or uninstalls.

!macro customInstall
  ; Preserve existing userData directory during upgrades
  SetShellVarContext current
!macroend

!macro customUnInstall
  ; Explicitly keep $APPDATA\Gestion Agence de Location intact so business records,
  ; encrypted customer vault documents, and backups remain recoverable.
!macroend
