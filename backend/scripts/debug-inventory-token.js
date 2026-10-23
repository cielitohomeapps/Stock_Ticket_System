require("dotenv").config();

async function main() {
  const email = process.env.FIREBASE_TEST_EMAIL;
  const password = process.env.FIREBASE_TEST_PASSWORD;
  const apiKey = process.env.INVENTORY_AUTH_API_KEY;
  const apiBase = (process.env.INVENTORY_API_BASE_URL || "").replace(/\/$/, "");

  if (!email || !password || !apiKey || !apiBase) {
    throw new Error("Define FIREBASE_TEST_EMAIL, FIREBASE_TEST_PASSWORD, INVENTORY_AUTH_API_KEY, and INVENTORY_API_BASE_URL.");
  }

  const authResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({email, password, returnSecureToken: true}),
    },
  );
  const authPayload = await authResponse.json();
  if (!authResponse.ok || !authPayload.idToken) {
    throw new Error(`Test-account sign-in failed (HTTP ${authResponse.status}).`);
  }

  const inventoryResponse = await fetch(`${apiBase}/productos`, {
    headers: {Authorization: `Bearer ${authPayload.idToken}`},
  });
  console.log(`Inventory API status: ${inventoryResponse.status}`);
  if (!inventoryResponse.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
