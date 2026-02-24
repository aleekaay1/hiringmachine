# Git auth for push (GitHub)

Author is set to **aleekaay1** (yourutable@gmail.com). Git is configured to use **GitHub CLI** for authentication so you can push without typing a token each time.

## One-time login (opens browser)

In **Cursor**, open the terminal (`` Ctrl+` `` or View → Terminal) and run:

```bash
npm run github:login
```

Or directly:

```bash
gh auth login -h github.com -p https -w
```

- Choose **GitHub.com**, **HTTPS**, and **Login with a web browser**.
- A browser window will open; sign in with your GitHub account (aleekaay1).
- After that, `git push` will work without asking for a password.

## Push

```bash
git push
```

No token needed after you’ve run the login once.
