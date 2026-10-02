require("dotenv").config();
const admin = require("firebase-admin");

function stripQuotes(value) {
  return String(value || "").replace(/^"|"$/g, "");
}

const creds = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: stripQuotes(process.env.FIREBASE_CLIENT_EMAIL),
  privateKey: stripQuotes(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n"),
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(creds),
  });
}

// Test 1: Try to get token with user credentials
async function testWithUserCredentials() {
  console.log("\n=== Testing with User Credentials ===");
  
  const email = "sistemasch17@gmail.com";
  const password = process.env.FIREBASE_TEST_PASSWORD;
  if (!password) {
    console.error("FIREBASE_TEST_PASSWORD no está definida en .env");
    return null;
  }
  
  try {
    const signUpRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.INVENTORY_AUTH_API_KEY}`,
      {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          email,
          password,
          returnSecureToken: true,
        }),
      },
    );

    const signUpPayload = await signUpRes.json();
    if (!signUpRes.ok) {
      console.log(`❌ Login failed: ${signUpPayload.error?.message}`);
      return null;
    }

    if (!signUpPayload.idToken) {
      console.log("❌ No ID token in response");
      return null;
    }

    console.log("✅ Got ID token successfully");
    const [, payloadB64] = signUpPayload.idToken.split(".");
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    console.log(`   aud=${decoded.aud}`);
    console.log(`   email=${decoded.email}`);

    // Test with inventory API
    const inventoryRes = await fetch(
      `${process.env.INVENTORY_API_BASE_URL}/productos`,
      {
        headers: {
          Authorization: `Bearer ${signUpPayload.idToken}`,
        },
      },
    );

    console.log(`   Inventory API status: ${inventoryRes.status}`);
    const text = await inventoryRes.text();
    console.log(`   Response preview: ${text.slice(0, 150)}`);
    
    if (inventoryRes.ok) {
      console.log("\n✅ SUCCESS! Token works with inventory API");
      console.log(`\nToken (first 50 chars): ${signUpPayload.idToken.slice(0, 50)}...`);
      return signUpPayload.idToken;
    } else {
      console.log("\n❌ Token not accepted by inventory API");
      return null;
    }
  } catch (error) {
    console.log("❌ Error:", error.message);
    return null;
  }
}

// Test 2: Create or get test user via Admin SDK
async function testWithAdminSDK() {
  console.log("\n=== Testing with Admin SDK ===");
  
  const email = "test@example.com";
  const password = "TestPassword123!";
  
  try {
    // Try to delete if exists
    try {
      await admin.auth().getUserByEmail(email);
      await admin.auth().deleteUser(await admin.auth().getUserByEmail(email).then(u => u.uid));
      console.log(`Deleted existing test user`);
    } catch (e) {
      // User doesn't exist, that's fine
    }

    // Create new test user
    const userRecord = await admin.auth().createUser({
      email,
      password,
      emailVerified: false,
    });
    console.log(`✅ Created test user: ${userRecord.uid}`);

    // Now get token for this user
    const signUpRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.INVENTORY_AUTH_API_KEY}`,
      {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          email,
          password,
          returnSecureToken: true,
        }),
      },
    );

    const signUpPayload = await signUpRes.json();
    if (!signUpRes.ok || !signUpPayload.idToken) {
      console.log("❌ Failed to get token:", signUpPayload.error?.message);
      return null;
    }

    console.log("✅ Got ID token");

    // Test with inventory API
    const inventoryRes = await fetch(
      `${process.env.INVENTORY_API_BASE_URL}/productos`,
      {
        headers: {
          Authorization: `Bearer ${signUpPayload.idToken}`,
        },
      },
    );

    console.log(`   Inventory API status: ${inventoryRes.status}`);
    
    if (inventoryRes.ok) {
      console.log("\n✅ SUCCESS! Test token works!");
      console.log(`\nFull Token:\n${signUpPayload.idToken}`);
      return signUpPayload.idToken;
    }
  } catch (error) {
    console.log("❌ Error:", error.message);
  }
  
  return null;
}

(async () => {
  const token1 = await testWithUserCredentials();
  
  if (!token1) {
    console.log("\n" + "=".repeat(50));
    const token2 = await testWithAdminSDK();
    if (token2) {
      console.log("\n✅ Use the token above in INVENTORY_STATIC_BEARER_TOKEN");
    }
  }
})();
