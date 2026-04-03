const { exec } = require('child_process');

const script = `
  set now to (current date)
  set tomorrow to now + (24 * 60 * 60)
  set output to ""
  tell application "Calendar"
    set calNames to name of calendars
    repeat with calName in calNames
      try
        set theCalendar to calendar calName
        set theEvents to (every event of theCalendar whose start date is greater than or equal to now and start date is less than or equal to tomorrow)
        repeat with theEvent in theEvents
          set output to output & (summary of theEvent) & "|" & (start date of theEvent) & "|" & calName & "\n"
        end repeat
      on error
      end try
    end repeat
  end tell
  return output
`;

exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error: ${error.message}`);
    return;
  }
  if (stderr) {
    console.error(`Stderr: ${stderr}`);
    return;
  }
  console.log('Stdout:', stdout);
});
