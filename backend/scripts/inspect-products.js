require('dotenv').config()
const admin = require('firebase-admin')

const creds = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: String(process.env.FIREBASE_CLIENT_EMAIL || '').replace(/^"|"$/g, ''),
  privateKey: String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/^"|"$/g, '').replace(/\\n/g, '\n'),
}
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(creds) })

async function main() {
  const email = 'probe_' + Date.now() + '@example.com'
  const user = await admin.auth().createUser({ email, password: 'Test1234!' })
  try {
    const customToken = await admin.auth().createCustomToken(user.uid)
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.INVENTORY_AUTH_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
    )
    const j = await r.json()
    const tok = j.idToken
    if (!tok) { console.error('No token:', j); return }

    // Fetch all products
    const pr = await fetch('https://cielitohome-storage-backend.onrender.com/api/productos', {
      headers: { Authorization: `Bearer ${tok}` }
    })
    console.log('HTTP status:', pr.status)
    const rawText = await pr.text()
    console.log('Raw response (first 800 chars):', rawText.slice(0, 800))
    const data = JSON.parse(rawText)
    console.log('Top-level keys:', Object.keys(data instanceof Object ? data : {}).join(', '))
    const arr = Array.isArray(data) ? data
      : Array.isArray(data?.data) ? data.data
      : Array.isArray(data?.products) ? data.products
      : []

    console.log('Total products:', arr.length)
    if (arr.length > 0) {
      const areaField = p => p.area || p.Area || p.departamento || p.Departamento || p.categoria || p.Categoria || p.sector || '???'
      const areas = [...new Set(arr.map(areaField))].sort()
      console.log('Unique areas:', areas.join(' | '))
      console.log('')

      // Show first 5 products with all their keys
      arr.slice(0, 5).forEach((p, i) => {
        console.log(`--- Product ${i} ---`)
        console.log('  Keys:', Object.keys(p).join(', '))
        Object.entries(p).forEach(([k, v]) => {
          console.log(`  ${k}: ${JSON.stringify(v)}`)
        })
      })
    }
  } finally {
    await admin.auth().deleteUser(user.uid).catch(() => {})
  }
}

main().catch(e => console.error('ERROR:', e.message))
