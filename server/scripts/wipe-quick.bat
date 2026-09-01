@echo off
REM Quick wipe for development - no confirmations
REM Run AFTER EnrollPro has wiped their data

echo ========================================
echo   SMART Database Quick Wipe
echo ========================================
echo.

cd /d "%~dp0\.."

echo [1/3] Dropping and recreating database...
psql -U postgres -c "DROP DATABASE IF EXISTS smart_db;"
psql -U postgres -c "CREATE DATABASE smart_db;"

echo [2/3] Pushing schema...
npx prisma db push --accept-data-loss

echo [3/3] Generating client...
npx prisma generate

echo.
echo ========================================
echo   Done! Database is clean.
echo ========================================
echo.
echo Next: npm run dev
echo.
pause
