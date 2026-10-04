@echo off
if not exist backups mkdir backups
for /f "tokens=1-4 delims=/ " %%a in ("%date%") do set D=%%d-%%b-%%c
copy data\cafe.sqlite backups\cafe-%D%.sqlite >nul
echo Backup created in backups\
