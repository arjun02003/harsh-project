# Nagpur Nest

Nagpur ke liye rooms/PG, mess/tiffin aur institute/coaching finder. Login ke baad search karne par owner ka number dikhta hai, aur searches limited hain.

## Kaise chalaye

Node.js 22.13 ya naya chahiye.

```bash
npm install
npm start
```

Browser me http://localhost:3000 kholo. Pehli baar 24 **sample** listings apne aap ban jaati hain (naam, price aur phone numbers sab nakli hain).

## Search ke rules

| Kya | Kitni searches |
| --- | --- |
| Free account banate hi | 1 |
| Har friend jo aapke referral link se signup kare | +4 (max 5 friends) |
| Pack, Rs 49 | 25 searches (expire nahi hoti) |
| Unlimited, Rs 99 | 30 din tak unlimited |

- Sirf wahi search ginti hai jisme results milte hain. Zero results wali search free hai.
- Wahi search 10 minute ke andar dobara karo to wo bhi free hai.
- Sab numbers `.env` se badal sakte ho (`.env.example` dekho).

## Admin (listings add karna)

1. Site pe normal signup karo.
2. Server pe chalao: `npm run make-admin -- aapka@email.com`
3. http://localhost:3000/admin kholo aur apne admin email/password se sign in karo. Admin access account ke saath save rehta hai; agali baar isi account se login karke panel khol sakte ho. Wahan listing add/delete, verified tick, aur "Delete all sample listings" button hai.

Sample listings hatane ka command bhi hai: `npm run clear-samples`.

## Payments

- Plan select karne par PhonePe QR aur 5-minute payment window dikhti hai. User transaction ID/UTR submit karta hai.
- Admin ko PhonePe/bank record me exact amount aur transaction reference check karke payment approve karna hota hai. Plan approval se pehle unlock nahi hota; reject karne par access nahi milta.
- QR static hai, isliye 5-minute timer website order ko band karta hai; QR khud expire nahi hota. Timer ke baad hua payment admin ko manually reconcile karna padega.
- “Payment complete” ka user-side button ya screenshot akela access unlock nahi karta.

## Live karne se pehle zaroor dekho

- Sample listings hatao aur apni asli listings daalo.
- PhonePe QR par real payment test karo aur admin dashboard se transaction verify hone ke baad hi plan activate karo.
- Site HTTPS pe chalao (cookies secure tabhi hoti hain jab `NODE_ENV=production` ho).
- `data/app.db` ka regular backup lo. Ye hi poora database hai.
- Privacy Policy, Terms aur Refund policy page banao. Razorpay inhe maangta hai, aur owners ke phone numbers dikhane ke liye unki permission lena zaroori hai.

## Jo abhi nahi hai

- **Email/phone verification.** Koi bhi kisi bhi email se signup kar sakta hai, to naye fake accounts se free searches kamayi ja sakti hain. Referral cap (5 friends) isiliye hai. Phone OTP baad me jodna sabse achha rasta hai.
- Password reset.
- Razorpay webhook (agar customer payment ke baad browser band kar de to searches tab tak nahi milengi jab tak webhook na ho).
- Listing photos aur owner self-signup. Abhi listings sirf admin add karta hai.

## Files

```
server.js        API: login, search + credits, referral, payments, admin
db.js            SQLite tables (node:sqlite, koi extra install nahi)
config.js        sab settings aur Nagpur ke areas
seed-data.js     24 sample listings
public/          website (index.html, app.js, styles.css) aur /admin
scripts/         make-admin, clear-samples
```
