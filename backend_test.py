#!/usr/bin/env python3
"""
WaveLead Milestone 00.1 Backend Testing Script
Tests all requirements from the review request
"""

import requests
import time
import json
from pymongo import MongoClient
import os

BASE_URL = "http://localhost:3000"
TEST_DB = "wavelead_test"

def print_test(name, passed, details=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"\n{status}: {name}")
    if details:
        print(f"  Details: {details}")

def extract_cookie(response, cookie_name="wl_session"):
    """Extract cookie value from Set-Cookie header"""
    set_cookie = response.headers.get('Set-Cookie', '')
    if cookie_name in set_cookie:
        for part in set_cookie.split(';'):
            if cookie_name in part:
                return part.strip()
    return None

print("=" * 80)
print("WaveLead Milestone 00.1 - Backend Testing")
print("=" * 80)

# ============================================================================
# Check 3: Product rename
# ============================================================================
print("\n" + "=" * 80)
print("CHECK 3: Product Rename")
print("=" * 80)

try:
    # 3a: Health endpoint returns service="wavelead"
    resp = requests.get(f"{BASE_URL}/api/health")
    health_data = resp.json()
    service_name = health_data.get('data', {}).get('service', '')
    print_test(
        "Health endpoint returns service='wavelead'",
        service_name == "wavelead",
        f"Got service='{service_name}'"
    )
except Exception as e:
    print_test("Health endpoint returns service='wavelead'", False, str(e))

try:
    # 3b: Signup returns wl_session cookie (not wh_session)
    timestamp = int(time.time())
    signup_email = f"test+{timestamp}@wavelead.test"
    resp = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={
            "email": signup_email,
            "password": "password123",
            "display_name": "Test User"
        }
    )
    cookie = extract_cookie(resp, "wl_session")
    has_wl_session = cookie is not None and "wl_session=" in cookie
    has_wh_session = "wh_session=" in resp.headers.get('Set-Cookie', '')
    print_test(
        "Signup returns wl_session cookie (not wh_session)",
        has_wl_session and not has_wh_session,
        f"wl_session found: {has_wl_session}, wh_session found: {has_wh_session}"
    )
except Exception as e:
    print_test("Signup returns wl_session cookie", False, str(e))

try:
    # 3c: Homepage contains "WaveLead" and not "WaveHub"
    resp = requests.get(f"{BASE_URL}/")
    html = resp.text
    has_wavelead = "WaveLead" in html
    has_wavehub = "WaveHub" in html
    print_test(
        "Homepage contains 'WaveLead' and not 'WaveHub'",
        has_wavelead and not has_wavehub,
        f"WaveLead found: {has_wavelead}, WaveHub found: {has_wavehub}"
    )
except Exception as e:
    print_test("Homepage branding check", False, str(e))

# ============================================================================
# Check 4: Broken nav fixed
# ============================================================================
print("\n" + "=" * 80)
print("CHECK 4: Navigation Routes")
print("=" * 80)

routes = ['/trending', '/top', '/pricing', '/about', '/terms', '/privacy', 
          '/channels', '/submit', '/login', '/signup']

for route in routes:
    try:
        resp = requests.get(f"{BASE_URL}{route}", allow_redirects=False)
        # Accept 200 or redirects (302, 307, 308) as valid
        is_ok = resp.status_code in [200, 302, 307, 308]
        print_test(
            f"Route {route} accessible",
            is_ok,
            f"Status: {resp.status_code}"
        )
    except Exception as e:
        print_test(f"Route {route} accessible", False, str(e))

# ============================================================================
# Check 5: Signup role logic
# ============================================================================
print("\n" + "=" * 80)
print("CHECK 5: Signup Role Logic")
print("=" * 80)

try:
    # 5a: Random email gets role=user
    timestamp = int(time.time())
    random_email = f"random+{timestamp}@wavelead.test"
    resp = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={
            "email": random_email,
            "password": "password123",
            "display_name": "Random User"
        }
    )
    data = resp.json()
    role = data.get('data', {}).get('user', {}).get('role', '')
    print_test(
        "Random email signup gets role=user",
        role == "user",
        f"Got role='{role}'"
    )
except Exception as e:
    print_test("Random email signup role check", False, str(e))

try:
    # 5b: Bootstrap email gets super_admin when DB is empty
    # Connect to test DB and clear users
    mongo_url = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
    client = MongoClient(mongo_url)
    db = client[TEST_DB]
    db.users.delete_many({})
    
    bootstrap_email = "admin@wavelead.dev"
    resp = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={
            "email": bootstrap_email,
            "password": "password123",
            "display_name": "Bootstrap Admin"
        }
    )
    data = resp.json()
    role = data.get('data', {}).get('user', {}).get('role', '')
    bootstrap_cookie = extract_cookie(resp, "wl_session")
    
    print_test(
        "Bootstrap email gets super_admin when DB empty",
        role == "super_admin",
        f"Got role='{role}'"
    )
    
    # 5c: Re-attempting bootstrap email after super_admin exists gets role=user
    timestamp = int(time.time())
    resp2 = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={
            "email": f"admin+{timestamp}@wavelead.dev",
            "password": "password123",
            "display_name": "Second Bootstrap Attempt"
        }
    )
    data2 = resp2.json()
    role2 = data2.get('data', {}).get('user', {}).get('role', '')
    print_test(
        "Bootstrap email after super_admin exists gets role=user",
        role2 == "user",
        f"Got role='{role2}'"
    )
    
    client.close()
except Exception as e:
    print_test("Bootstrap role logic", False, str(e))

# ============================================================================
# Check 6: Live-role authorization (MOST IMPORTANT)
# ============================================================================
print("\n" + "=" * 80)
print("CHECK 6: Live-Role Authorization (CRITICAL)")
print("=" * 80)

try:
    # 6a: Wipe users, signup as admin@wavelead.dev, capture cookie
    mongo_url = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
    client = MongoClient(mongo_url)
    db = client[TEST_DB]
    db.users.delete_many({})
    
    bootstrap_email = "admin@wavelead.dev"
    resp = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={
            "email": bootstrap_email,
            "password": "password123",
            "display_name": "Super Admin"
        }
    )
    data = resp.json()
    user_id = data.get('data', {}).get('user', {}).get('id', '')
    cookie = extract_cookie(resp, "wl_session")
    
    print_test(
        "6a: Super admin signup successful",
        resp.status_code == 200 and cookie is not None,
        f"Status: {resp.status_code}, Cookie: {cookie is not None}"
    )
    
    # 6b: GET /api/admin/ping with super_admin cookie returns 200
    resp = requests.get(
        f"{BASE_URL}/api/admin/ping",
        headers={"Cookie": cookie}
    )
    data = resp.json()
    role = data.get('data', {}).get('role', '')
    print_test(
        "6b: Super admin can access /api/admin/ping",
        resp.status_code == 200 and role == "super_admin",
        f"Status: {resp.status_code}, Role: {role}"
    )
    
    # 6c: Downgrade user in MongoDB
    db.users.update_one(
        {"id": user_id},
        {"$set": {"role": "user"}}
    )
    print("  → Downgraded user role in DB from super_admin to user")
    
    # 6d: Same cookie must now be denied (403)
    resp = requests.get(
        f"{BASE_URL}/api/admin/ping",
        headers={"Cookie": cookie}
    )
    print_test(
        "6d: CRITICAL - Same cookie denied after DB role downgrade",
        resp.status_code == 403,
        f"Status: {resp.status_code} (expected 403)"
    )
    
    # 6e: Unauthenticated request returns 401
    resp = requests.get(f"{BASE_URL}/api/admin/ping")
    print_test(
        "6e: Unauthenticated /api/admin/ping returns 401",
        resp.status_code == 401,
        f"Status: {resp.status_code}"
    )
    
    client.close()
except Exception as e:
    print_test("Live-role authorization", False, str(e))

# ============================================================================
# Check 7: Rate limiting
# ============================================================================
print("\n" + "=" * 80)
print("CHECK 7: Rate Limiting")
print("=" * 80)

try:
    # 7a: Login rate limiting (9+ attempts should trigger 429)
    test_email = f"ratelimit+{int(time.time())}@wavelead.test"
    # First create the user
    requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={
            "email": test_email,
            "password": "correct123",
            "display_name": "Rate Limit Test"
        }
    )
    
    # Now try 9 failed login attempts
    got_429 = False
    for i in range(10):
        resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": test_email, "password": "wrong"}
        )
        if resp.status_code == 429:
            got_429 = True
            break
    
    print_test(
        "Login rate limiting triggers 429",
        got_429,
        f"Got 429 after rapid failed login attempts: {got_429}"
    )
    
    # Wait a bit before next test
    time.sleep(2)
    
    # 7b: Signup rate limiting (6+ attempts should trigger 429)
    got_429 = False
    for i in range(7):
        resp = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "email": f"signup{i}+{int(time.time())}@wavelead.test",
                "password": "password123",
                "display_name": f"Signup {i}"
            }
        )
        if resp.status_code == 429:
            got_429 = True
            break
    
    print_test(
        "Signup rate limiting triggers 429",
        got_429,
        f"Got 429 after rapid signup attempts: {got_429}"
    )
except Exception as e:
    print_test("Rate limiting", False, str(e))

# Wait for rate limits to reset
time.sleep(3)

# ============================================================================
# Check 8: CORS explicit allowlist
# ============================================================================
print("\n" + "=" * 80)
print("CHECK 8: CORS Explicit Allowlist")
print("=" * 80)

try:
    # 8a: Evil origin should NOT be allowed
    resp = requests.get(
        f"{BASE_URL}/api/health",
        headers={"Origin": "https://evil.example"}
    )
    acao = resp.headers.get('Access-Control-Allow-Origin', '')
    is_safe = acao != "*" and acao != "https://evil.example"
    print_test(
        "Evil origin NOT allowed",
        is_safe,
        f"Access-Control-Allow-Origin: '{acao}' (should not be * or evil.example)"
    )
    
    # 8b: Allowed origin should be echoed
    allowed_origin = "https://grow-infrastructure.preview.emergentagent.com"
    resp = requests.get(
        f"{BASE_URL}/api/health",
        headers={"Origin": allowed_origin}
    )
    acao = resp.headers.get('Access-Control-Allow-Origin', '')
    vary = resp.headers.get('Vary', '')
    is_correct = acao == allowed_origin and 'Origin' in vary
    print_test(
        "Allowed origin echoed with Vary: Origin",
        is_correct,
        f"ACAO: '{acao}', Vary: '{vary}'"
    )
    
    # 8c: No wildcard with credentials
    has_wildcard_with_creds = (
        resp.headers.get('Access-Control-Allow-Origin') == '*' and
        resp.headers.get('Access-Control-Allow-Credentials', '').lower() == 'true'
    )
    print_test(
        "No wildcard CORS with credentials",
        not has_wildcard_with_creds,
        f"Wildcard with credentials: {has_wildcard_with_creds}"
    )
except Exception as e:
    print_test("CORS allowlist", False, str(e))

# ============================================================================
# Check 9: Discovery endpoints unchanged (regression)
# ============================================================================
print("\n" + "=" * 80)
print("CHECK 9: Discovery Endpoints (Regression Check)")
print("=" * 80)

try:
    # 9a: GET /api/categories (>=25 items)
    resp = requests.get(f"{BASE_URL}/api/categories")
    data = resp.json()
    categories = data.get('data', {}).get('categories', [])
    print_test(
        "GET /api/categories returns >=25 items",
        len(categories) >= 25,
        f"Got {len(categories)} categories"
    )
except Exception as e:
    print_test("GET /api/categories", False, str(e))

try:
    # 9b: GET /api/channels?limit=5 (total>=20, first item structure)
    resp = requests.get(f"{BASE_URL}/api/channels?limit=5")
    data = resp.json()
    total = data.get('data', {}).get('total', 0)
    # Channels endpoint returns 'items' not 'channels'
    channels = data.get('data', {}).get('items', [])
    
    print_test(
        "GET /api/channels total>=20",
        total >= 20,
        f"Total: {total}"
    )
    
    if channels:
        first = channels[0]
        has_owner_id = 'owner_id' in first
        has_verification_status = 'verification_status' in first
        has_is_verified = 'is_verified' in first
        print_test(
            "First channel has no owner_id/verification_status but has is_verified",
            not has_owner_id and not has_verification_status and has_is_verified,
            f"owner_id: {has_owner_id}, verification_status: {has_verification_status}, is_verified: {has_is_verified}"
        )
except Exception as e:
    print_test("GET /api/channels", False, str(e))

try:
    # 9c: GET /api/channels/featured (6 items)
    resp = requests.get(f"{BASE_URL}/api/channels/featured")
    data = resp.json()
    # Featured endpoint returns 'items' not 'channels'
    channels = data.get('data', {}).get('items', [])
    print_test(
        "GET /api/channels/featured returns 6 items",
        len(channels) == 6,
        f"Got {len(channels)} channels"
    )
except Exception as e:
    print_test("GET /api/channels/featured", False, str(e))

try:
    # 9d: GET /api/stats returns totalApproved & totalPending
    resp = requests.get(f"{BASE_URL}/api/stats")
    data = resp.json()
    stats = data.get('data', {})
    has_approved = 'totalApproved' in stats
    has_pending = 'totalPending' in stats
    print_test(
        "GET /api/stats returns totalApproved & totalPending",
        has_approved and has_pending,
        f"totalApproved: {has_approved}, totalPending: {has_pending}"
    )
except Exception as e:
    print_test("GET /api/stats", False, str(e))

try:
    # 9e: GET /api/channels/nusantara-daily returns channel
    resp = requests.get(f"{BASE_URL}/api/channels/nusantara-daily")
    print_test(
        "GET /api/channels/nusantara-daily returns channel",
        resp.status_code == 200,
        f"Status: {resp.status_code}"
    )
except Exception as e:
    print_test("GET /api/channels/nusantara-daily", False, str(e))

try:
    # 9f: Unknown slug returns 404
    resp = requests.get(f"{BASE_URL}/api/channels/unknown-nonexistent-slug-12345")
    print_test(
        "Unknown channel slug returns 404",
        resp.status_code == 404,
        f"Status: {resp.status_code}"
    )
except Exception as e:
    print_test("Unknown channel slug 404", False, str(e))

# ============================================================================
# Check 10: Seed idempotency
# ============================================================================
print("\n" + "=" * 80)
print("CHECK 10: Seed Idempotency")
print("=" * 80)

try:
    # Note: Testing against live wavelead DB as per instructions
    # Get initial stats
    resp1 = requests.get(f"{BASE_URL}/api/stats")
    stats1 = resp1.json().get('data', {})
    
    # Run seed (no force)
    resp_seed1 = requests.post(f"{BASE_URL}/api/admin/seed")
    
    # Get stats after first seed
    resp2 = requests.get(f"{BASE_URL}/api/stats")
    stats2 = resp2.json().get('data', {})
    
    # Run seed again (no force)
    resp_seed2 = requests.post(f"{BASE_URL}/api/admin/seed")
    
    # Get stats after second seed
    resp3 = requests.get(f"{BASE_URL}/api/stats")
    stats3 = resp3.json().get('data', {})
    
    # Stats should be identical after both seeds
    totals_match = (
        stats2.get('totalApproved') == stats3.get('totalApproved') and
        stats2.get('totalPending') == stats3.get('totalPending')
    )
    
    print_test(
        "Seed idempotency - no duplicates on repeated calls",
        totals_match,
        f"After 1st seed: {stats2.get('totalApproved')} approved, After 2nd seed: {stats3.get('totalApproved')} approved"
    )
except Exception as e:
    print_test("Seed idempotency", False, str(e))

print("\n" + "=" * 80)
print("Backend Testing Complete")
print("=" * 80)
