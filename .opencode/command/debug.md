---
description: Debug using PM2 logs
---

Ask user: "What's the error or issue you're seeing?"

After user answers:

1. Check PM2 status:
```bash
pm2 list
```

2. Check PM2 logs for errors:
```bash
pm2 logs --lines 100 --nostream
```

3. Check for error patterns:
```bash
pm2 logs --err --lines 50 --nostream
```

4. Analyze the logs and report:
- What the error is
- Which file/service caused it
- Suggested fix

If fix involves code changes, offer to implement them.
