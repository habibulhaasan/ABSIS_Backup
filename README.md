# Capital Sync — Donation & Fund Management Platform

A full-featured web application for managing member contributions, verifying payments, tracking expenses, and overseeing organizational funds — all in one place.

---

## 🚀 Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org/) (App Router) |
| UI | React 19 + Tailwind CSS 4 |
| Database | Firebase Firestore |
| Authentication | Firebase Auth |
| File Storage | Google Drive API |
| Hosting | Vercel / Firebase Hosting |

---

## ✨ Features

- **Member Management** — Register members, manage profiles, track subscriptions and entry fees
- **Payment Verification** — Admin can verify and approve member payments
- **Dashboard** — Real-time fund overview with budget bars and balance tracking
- **Expense Tracking** — Log and monitor organizational expenses
- **Investment & Projects** — Manage investment projects, portfolios and returns
- **Loan Management** — Track loans issued to members
- **Distribution** — Handle fund distributions linked to investment projects
- **Capital & Fund Structure** — Define fund budgets by amount or percentage
- **Charity Management** — Track charity allocations and spending
- **Ledger & Account Book** — Full financial ledger with monthly breakdowns
- **Reports & Quarterly Reports** — Generate financial summaries
- **File Management** — Upload and manage files via Google Drive
- **Notifications** — In-app notification system
- **Multi-Organization Support** — Users can belong to and switch between multiple organizations
- **Role-Based Access** — Superadmin, Admin, Cashier and Member roles
- **Penalties** — Track and manage member penalties

---

## 📁 Project Structure

```
src/
├── app/
│   ├── admin/              # Admin-only pages
│   │   ├── account-book/
│   │   ├── assets/
│   │   ├── capital/
│   │   ├── charity/
│   │   ├── distribution/
│   │   ├── entry-fees/
│   │   ├── expenses/
│   │   ├── files/
│   │   ├── fund-structure/
│   │   ├── investments/
│   │   ├── ledger/
│   │   ├── loans/
│   │   ├── members/
│   │   ├── monthly-ledger/
│   │   ├── notifications/
│   │   ├── penalties/
│   │   ├── portfolio/
│   │   ├── projects/
│   │   ├── reports/
│   │   ├── settings/
│   │   ├── subscriptions/
│   │   ├── summary/
│   │   └── verify/
│   ├── superadmin/         # Superadmin pages
│   ├── api/                # API routes (file upload, Google Drive)
│   ├── dashboard/          # Member dashboard
│   ├── login/
│   ├── register/
│   └── ...                 # Other member-facing pages
├── components/
│   ├── Sidebar.js
│   ├── Shell.js
│   └── Modal.js
├── context/
│   └── AuthContext.js      # Global auth & org state
└── lib/
    ├── firebase.js         # Firebase config
    └── googleDrive.js      # Google Drive integration
```

---

## ⚙️ Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/your-username/capital-sync.git
cd capital-sync
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env.local` file in the project root:

```env
# Firebase
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# Google OAuth & Drive
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REFRESH_TOKEN=your_google_refresh_token
```

### 4. Set up Firebase

```bash
npm install -g firebase-tools
firebase login
firebase use --add   # Select your Capital Sync project
firebase deploy --only firestore:rules
```

### 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🔐 Authentication & Roles

| Role | Access |
|---|---|
| **Superadmin** | Full system access, manage all organizations and admins |
| **Admin** | Manage all features within their organization |
| **Cashier** | Handle transfers and payment operations |
| **Member** | View personal dashboard, loans, installments and files |

---

## 🔑 Getting Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to **APIs & Services → Credentials**
3. Click **+ Create Credentials → OAuth Client ID**
4. Set application type to **Web Application**
5. Add `http://localhost:3000` to Authorized JavaScript Origins
6. Add `http://localhost:3000/api/auth/callback/google` to Authorized Redirect URIs
7. Copy the **Client ID** and **Client Secret** into `.env.local`

---

## 🚀 Deployment

### Build for production

```bash
npm run build
npm start
```

### Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Make sure to add all `.env.local` variables to your Vercel project's environment settings.

---

## 📜 License

This project is private and proprietary. All rights reserved © 2025 Capital Sync.