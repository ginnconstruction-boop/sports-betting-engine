# Deploy to Render -- Step by Step

## Prerequisites
- GitHub account with sports-betting-engine repo already pushed
- Render account at render.com (free)

---

## Deploy on Render (15 minutes)

### Step 1 -- Push latest code to GitHub
In your sports-betting-engine folder run:

  git add .
  git commit -m "render deployment"
  git push

### Step 2 -- Create new Web Service on Render
1. Go to render.com and log in
2. Click "New +" then "Web Service"
3. Click "Connect a repository"
4. Select your GitHub account and choose "sports-betting-engine"
5. Click "Connect"

### Step 3 -- Configure the service
Render will detect render.yaml automatically. Verify:
  Name:           sports-betting-engine
  Runtime:        Node
  Build Command:  npm install
  Start Command:  node --require ts-node/register server.ts
  Plan:           Free

### Step 4 -- Set environment variables
Click "Environment" and add these (click "Add Environment Variable"):

  ODDS_API_KEY      = (paste your API key from .env file)
  DASHBOARD_USER    = Imracing13
  DASHBOARD_PASS    = Cg13Sg12!
  SESSION_SECRET    = sbe2026secret
  BANKROLL          = 1000

Optional (for email alerts):
  ALERT_EMAIL_ENABLED = true
  ALERT_EMAIL_TO      = your@email.com
  ALERT_EMAIL_FROM    = your@gmail.com
  ALERT_EMAIL_PASS    = your-app-password

### Step 5 -- Add Persistent Disk (keeps your picks log!)
1. Click "Disks" in the left sidebar
2. Click "Add Disk"
3. Name: snapshots
4. Mount Path: /var/data/snapshots
5. Size: 1 GB (free tier)

This is critical -- without the disk your picks log resets on every deploy.

### Step 6 -- Deploy
Click "Create Web Service". Render builds and deploys automatically.
Takes about 3-5 minutes. Watch the build log for any errors.

### Step 7 -- Get your URL
Once green/deployed, your URL appears at the top:
  https://sports-betting-engine.onrender.com

Open on any device, log in with Imracing13 / your password.

---

## Important: Render Free Tier Sleep Policy
Free tier services spin down after 15 minutes of inactivity.
First request after idle takes 30-60 seconds to wake up.
To avoid this: upgrade to Starter plan ($7/month) for always-on.
Or just accept the 30-second wake time -- it only affects the first
tap after you haven't used it for a while.

---

## Updating the app
Every time you get a new zip from Claude:
1. Extract and replace your local folder
2. Run: git add . && git commit -m "update" && git push
3. Render redeploys automatically in about 3 minutes

---

## Your picks data persists
The persistent disk at /var/data/snapshots holds:
  picks_log.json    -- all tracked picks
  pnl_record.json   -- win/loss record
  retro_analysis.json -- retrospective data
  signal_weights.json -- learned weights
  daily_reports/    -- HTML pick reports

Data survives redeploys and restarts.
