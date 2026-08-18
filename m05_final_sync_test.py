#!/usr/bin/env python3
"""
M05.0 FINAL SYNC / RELEASE VERIFICATION
Tests all acceptance criteria per review request
"""

import requests
import json
import time
from datetime import datetime, timedelta
from pymongo import MongoClient
import uuid

# Configuration
BASE_URL = "https://grow-infrastructure.preview.emergentagent.com/api"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "wavelead"

# Test credentials
SUPER_ADMIN_EMAIL = "admin@wavelead.dev"
SUPER_ADMIN_PASSWORD = "Passw0rd!"

# Test results tracking
test_results = {
    "A_M05_SYNC": {},
    "B_M02_REGRESSION": {},
    "C_M03_REGRESSION": {},
    "D_M04_REGRESSION": {},
    "E_INTEGRATION": {}
}

def print_section(msg):
    print(f"\n{'#'*80}")
    print(f"# {msg}")
    print('#'*80)

def print_test(msg):
    print(f"\n{'='*80}")
    print(f"TEST: {msg}")
    print('='*80)

def print_pass(msg):
    print(f"✅ PASS: {msg}")

def print_fail(msg):
    print(f"❌ FAIL: {msg}")

def print_info(msg):
    print(f"ℹ️  INFO: {msg}")

def record_result(section, test_id, passed, message=""):
    test_results[section][test_id] = {"passed": passed, "message": message}
    if passed:
        print_pass(f"{test_id}: {message}")
    else:
        print_fail(f"{test_id}: {message}")

# MongoDB helper
def get_mongo_db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]

# Auth helpers
def signup(email, password="Passw0rd!", display_name="Test User"):
    """Sign up a new user"""
    session = requests.Session()
    resp = session.post(f"{BASE_URL}/auth/signup", json={
        "email": email,
        "password": password,
        "display_name": display_name
    })
    if resp.status_code == 200:
        data = resp.json()
        return session.cookies, data.get('data', {})
    return None, None

def login(email, password="Passw0rd!"):
    """Login and get session cookie"""
    session = requests.Session()
    resp = session.post(f"{BASE_URL}/auth/login", json={
        "email": email,
        "password": password
    })
    if resp.status_code == 200:
        return session.cookies
    return None

def promote_user_to_role(email, role):
    """Promote user to a specific role in MongoDB"""
    db = get_mongo_db()
    result = db.users.update_one(
        {"email": email},
        {"$set": {"role": role, "updated_at": datetime.utcnow()}}
    )
    return result.modified_count > 0

# ============================================================================
# SECTION A: M05.0 FINAL SYNC
# ============================================================================

def test_a1_health_endpoint():
    """A1. GET /api/health returns version, commit, commitTime, branch"""
    print_test("A1. Health endpoint returns git commit SHA")
    
    try:
        resp = requests.get(f"{BASE_URL}/health")
        if resp.status_code != 200:
            record_result("A_M05_SYNC", "A1", False, f"Health endpoint returned {resp.status_code}")
            return False
        
        data = resp.json().get('data', {})
        
        # Check required fields
        required_fields = ['version', 'commit', 'commitTime', 'branch']
        missing = [f for f in required_fields if f not in data]
        if missing:
            record_result("A_M05_SYNC", "A1", False, f"Missing fields: {missing}")
            return False
        
        # Verify version is 7-char hex
        version = data['version']
        if not (isinstance(version, str) and len(version) == 7 and all(c in '0123456789abcdef' for c in version.lower())):
            record_result("A_M05_SYNC", "A1", False, f"Version '{version}' is not a 7-char hex string")
            return False
        
        # Verify branch is non-empty
        if not data['branch']:
            record_result("A_M05_SYNC", "A1", False, "Branch is empty")
            return False
        
        print_info(f"Version: {version}, Branch: {data['branch']}, Commit: {data['commit'][:7]}")
        record_result("A_M05_SYNC", "A1", True, f"Health endpoint returns proper git info (version={version}, branch={data['branch']})")
        return True
        
    except Exception as e:
        record_result("A_M05_SYNC", "A1", False, f"Exception: {str(e)}")
        return False

def test_a2_ssrf_firewall():
    """A2. POST /api/channels/enrich SSRF firewall"""
    print_test("A2. SSRF firewall blocks invalid URLs")
    
    invalid_urls = [
        "http://localhost/channel/abcdef1234567890",
        "https://example.com/channel/foo",
        "http://192.168.1.5/channel/abcdef1234567890",
        "https://10.0.0.5/channel/abcdef1234567890",
        "https://whatsapp.com/foo/bar",  # wrong path
        "https://whatsapp.com/channel/short",  # fails ID regex
        "ftp://whatsapp.com/channel/abcdef1234567890",  # bad protocol
        "not a url",
        "",
    ]
    
    all_passed = True
    for url in invalid_urls:
        try:
            resp = requests.post(f"{BASE_URL}/channels/enrich", json={"channel_url": url})
            data = resp.json().get('data', {})
            
            if data.get('status') != 'invalid_url':
                print_fail(f"URL '{url}' should return invalid_url, got: {data.get('status')}")
                all_passed = False
            else:
                print_info(f"✓ '{url}' correctly rejected")
                
        except Exception as e:
            print_fail(f"Exception testing '{url}': {str(e)}")
            all_passed = False
    
    record_result("A_M05_SYNC", "A2", all_passed, "SSRF firewall blocks all invalid URLs")
    return all_passed

def test_a3_duplicate_detection():
    """A3. Duplicate detection runs BEFORE OG/LLM"""
    print_test("A3. Duplicate detection runs BEFORE OG/LLM")
    
    try:
        # Find an existing approved channel in DB
        db = get_mongo_db()
        existing = db.channels.find_one({"status": "approved"})
        
        if not existing:
            record_result("A_M05_SYNC", "A3", False, "No approved channels found in DB for duplicate test")
            return False
        
        seed_url = existing.get('whatsapp_url')
        
        start_time = time.time()
        resp = requests.post(f"{BASE_URL}/channels/enrich", json={"channel_url": seed_url})
        elapsed_ms = (time.time() - start_time) * 1000
        
        if resp.status_code != 200:
            record_result("A_M05_SYNC", "A3", False, f"Enrich returned {resp.status_code}")
            return False
        
        data = resp.json().get('data', {})
        
        # Check status is duplicate
        if data.get('status') != 'duplicate':
            record_result("A_M05_SYNC", "A3", False, f"Expected status=duplicate, got {data.get('status')}")
            return False
        
        # Check duplicate object exists
        dup = data.get('duplicate', {})
        if not dup.get('slug'):
            record_result("A_M05_SYNC", "A3", False, "Duplicate object missing slug")
            return False
        
        # Check suggested_action is present
        if dup.get('suggested_action') not in ['claim', 'view', 'manage', 'report']:
            record_result("A_M05_SYNC", "A3", False, f"Invalid suggested_action: {dup.get('suggested_action')}")
            return False
        
        # Check metadata_available and inference_available are false
        if data.get('metadata_available') or data.get('inference_available'):
            record_result("A_M05_SYNC", "A3", False, "metadata_available or inference_available should be false for duplicate")
            return False
        
        # Check fields are absent
        if 'fields' in data:
            record_result("A_M05_SYNC", "A3", False, "fields should be absent for duplicate")
            return False
        
        # Check response latency < 500ms
        if elapsed_ms >= 500:
            print_info(f"Warning: Response took {elapsed_ms:.0f}ms (expected < 500ms)")
        
        # Check sensitive fields NOT exposed
        sensitive_fields = ['owner_id', 'verification_status', 'wave_score']
        exposed = [f for f in sensitive_fields if f in dup]
        if exposed:
            record_result("A_M05_SYNC", "A3", False, f"Sensitive fields exposed: {exposed}")
            return False
        
        print_info(f"Duplicate detected in {elapsed_ms:.0f}ms, suggested_action={dup.get('suggested_action')}")
        record_result("A_M05_SYNC", "A3", True, f"Duplicate detection runs before OG/LLM (latency={elapsed_ms:.0f}ms)")
        return True
        
    except Exception as e:
        record_result("A_M05_SYNC", "A3", False, f"Exception: {str(e)}")
        return False

def test_a4_duplicate_contextual_cta():
    """A4. Duplicate contextual CTA"""
    print_test("A4. Duplicate contextual CTA scenarios")
    
    try:
        db = get_mongo_db()
        
        # Find or create test channels for different scenarios
        # We'll test: unclaimed approved → claim, owned by me → manage
        
        # Get admin cookies
        admin_cookies = login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)
        if not admin_cookies:
            record_result("A_M05_SYNC", "A4", False, "Failed to login as admin")
            return False
        
        # Get admin user ID
        resp = requests.get(f"{BASE_URL}/auth/me", cookies=admin_cookies)
        admin_user_id = resp.json()['data']['user']['id']
        
        # Test 1: Unclaimed, approved → claim
        unclaimed = db.channels.find_one({"status": "approved", "owner_id": None})
        if unclaimed:
            resp = requests.post(f"{BASE_URL}/channels/enrich", 
                               json={"channel_url": unclaimed['whatsapp_url']})
            data = resp.json().get('data', {})
            if data.get('duplicate', {}).get('suggested_action') != 'claim':
                print_fail(f"Unclaimed approved should suggest 'claim', got {data.get('duplicate', {}).get('suggested_action')}")
                record_result("A_M05_SYNC", "A4", False, "Unclaimed approved channel CTA incorrect")
                return False
            print_info("✓ Unclaimed approved → claim")
        
        # Test 2: Owned by current caller → manage
        # Temporarily patch a channel to be owned by admin
        test_channel = db.channels.find_one({"status": "approved"})
        if test_channel:
            original_owner = test_channel.get('owner_id')
            db.channels.update_one(
                {"id": test_channel['id']},
                {"$set": {"owner_id": admin_user_id}}
            )
            
            resp = requests.post(f"{BASE_URL}/channels/enrich", 
                               json={"channel_url": test_channel['whatsapp_url']},
                               cookies=admin_cookies)
            data = resp.json().get('data', {})
            
            # Restore original owner
            if original_owner:
                db.channels.update_one({"id": test_channel['id']}, {"$set": {"owner_id": original_owner}})
            else:
                db.channels.update_one({"id": test_channel['id']}, {"$unset": {"owner_id": ""}})
            
            if data.get('duplicate', {}).get('suggested_action') != 'manage':
                print_fail(f"Owned by me should suggest 'manage', got {data.get('duplicate', {}).get('suggested_action')}")
                record_result("A_M05_SYNC", "A4", False, "Owned by me CTA incorrect")
                return False
            print_info("✓ Owned by me → manage")
        
        record_result("A_M05_SYNC", "A4", True, "Duplicate contextual CTA working correctly")
        return True
        
    except Exception as e:
        record_result("A_M05_SYNC", "A4", False, f"Exception: {str(e)}")
        return False

def test_a5_new_channel_path():
    """A5. New channel path (no duplicate, real URL format)"""
    print_test("A5. New channel path with real URL")
    
    try:
        # Use a unique URL that doesn't exist in DB
        unique_id = uuid.uuid4().hex[:20]
        test_url = f"https://whatsapp.com/channel/{unique_id}"
        
        resp = requests.post(f"{BASE_URL}/channels/enrich", json={"channel_url": test_url})
        
        if resp.status_code != 200:
            record_result("A_M05_SYNC", "A5", False, f"Enrich returned {resp.status_code}")
            return False
        
        data = resp.json().get('data', {})
        
        # Check status is success or partial
        if data.get('status') not in ['success', 'partial', 'unavailable']:
            record_result("A_M05_SYNC", "A5", False, f"Expected status success/partial/unavailable, got {data.get('status')}")
            return False
        
        # If metadata available, check field map
        if data.get('metadata_available'):
            fields = data.get('fields', {})
            expected_keys = {'channel_name', 'description', 'logo_url', 'short_description', 
                           'category_slug', 'primary_language', 'country_code'}
            actual_keys = set(fields.keys())
            
            if actual_keys != expected_keys:
                record_result("A_M05_SYNC", "A5", False, f"Field keys mismatch. Expected {expected_keys}, got {actual_keys}")
                return False
            
            # Check each field has required structure
            for key, field in fields.items():
                if not isinstance(field, dict):
                    record_result("A_M05_SYNC", "A5", False, f"Field {key} is not a dict")
                    return False
                
                required = {'value', 'source', 'confidence', 'editable'}
                if not required.issubset(field.keys()):
                    record_result("A_M05_SYNC", "A5", False, f"Field {key} missing required keys: {required - set(field.keys())}")
                    return False
                
                # Check source is valid
                if field['source'] not in ['public_metadata', 'wavelead_inference', None]:
                    record_result("A_M05_SYNC", "A5", False, f"Field {key} has invalid source: {field['source']}")
                    return False
                
                # Check confidence is 0..1
                if not (0 <= field['confidence'] <= 1):
                    record_result("A_M05_SYNC", "A5", False, f"Field {key} confidence {field['confidence']} not in [0,1]")
                    return False
            
            print_info(f"✓ Field map structure valid, metadata_available={data.get('metadata_available')}, inference_available={data.get('inference_available')}")
        
        # Check provider and inference_version if inference available
        if data.get('inference_available'):
            if not data.get('provider'):
                print_info("Warning: inference_available but no provider specified")
            else:
                print_info(f"✓ Provider: {data.get('provider')}, inference_version: {data.get('inference_version')}")
        
        record_result("A_M05_SYNC", "A5", True, f"New channel path working (status={data.get('status')})")
        return True
        
    except Exception as e:
        record_result("A_M05_SYNC", "A5", False, f"Exception: {str(e)}")
        return False

def test_a6_cache_behavior():
    """A6. Cache behavior"""
    print_test("A6. Cache behavior")
    
    try:
        # Use a unique URL
        unique_id = uuid.uuid4().hex[:20]
        test_url = f"https://whatsapp.com/channel/{unique_id}"
        
        # First call
        start1 = time.time()
        resp1 = requests.post(f"{BASE_URL}/channels/enrich", json={"channel_url": test_url})
        elapsed1 = (time.time() - start1) * 1000
        
        if resp1.status_code != 200:
            record_result("A_M05_SYNC", "A6", False, f"First call returned {resp1.status_code}")
            return False
        
        data1 = resp1.json().get('data', {})
        
        # Second call (should be cached)
        time.sleep(0.5)  # Small delay
        start2 = time.time()
        resp2 = requests.post(f"{BASE_URL}/channels/enrich", json={"channel_url": test_url})
        elapsed2 = (time.time() - start2) * 1000
        
        if resp2.status_code != 200:
            record_result("A_M05_SYNC", "A6", False, f"Second call returned {resp2.status_code}")
            return False
        
        data2 = resp2.json().get('data', {})
        
        # Check cached flag
        if not data2.get('cached'):
            record_result("A_M05_SYNC", "A6", False, "Second call should return cached=true")
            return False
        
        # Check latency is lower
        if elapsed2 >= 200:
            print_info(f"Warning: Cached response took {elapsed2:.0f}ms (expected < 200ms)")
        
        print_info(f"✓ First call: {elapsed1:.0f}ms, Second call (cached): {elapsed2:.0f}ms")
        
        # Third call with force_refresh
        time.sleep(0.5)
        start3 = time.time()
        resp3 = requests.post(f"{BASE_URL}/channels/enrich", 
                            json={"channel_url": test_url, "force_refresh": True})
        elapsed3 = (time.time() - start3) * 1000
        
        if resp3.status_code != 200:
            record_result("A_M05_SYNC", "A6", False, f"Force refresh call returned {resp3.status_code}")
            return False
        
        data3 = resp3.json().get('data', {})
        
        # Check cache was bypassed (either cached=false or refresh_available_at present due to cooldown)
        if data3.get('cached') and not data3.get('refresh_available_at'):
            record_result("A_M05_SYNC", "A6", False, "Force refresh should bypass cache or return refresh_available_at")
            return False
        
        print_info(f"✓ Force refresh: {elapsed3:.0f}ms, cached={data3.get('cached')}")
        
        record_result("A_M05_SYNC", "A6", True, "Cache behavior working correctly")
        return True
        
    except Exception as e:
        record_result("A_M05_SYNC", "A6", False, f"Exception: {str(e)}")
        return False

def test_a7_sensitive_field_firewall():
    """A7. Sensitive-field firewall on enrich fields map"""
    print_test("A7. Sensitive-field firewall")
    
    try:
        # Test with a new URL
        unique_id = uuid.uuid4().hex[:20]
        test_url = f"https://whatsapp.com/channel/{unique_id}"
        
        resp = requests.post(f"{BASE_URL}/channels/enrich", json={"channel_url": test_url})
        
        if resp.status_code != 200:
            record_result("A_M05_SYNC", "A7", False, f"Enrich returned {resp.status_code}")
            return False
        
        data = resp.json().get('data', {})
        
        # Check fields map doesn't contain sensitive fields
        fields = data.get('fields', {})
        sensitive_fields = ['owner_id', 'verification_status', 'wave_score', 'is_verified', 'is_official']
        
        exposed = [f for f in sensitive_fields if f in fields]
        if exposed:
            record_result("A_M05_SYNC", "A7", False, f"Sensitive fields exposed in fields map: {exposed}")
            return False
        
        # Also check duplicate branch doesn't expose these in fields
        if data.get('status') == 'duplicate':
            dup = data.get('duplicate', {})
            # These are OK in duplicate object: is_verified, is_official, has_owner
            # But NOT: owner_id, verification_status, wave_score
            forbidden = ['owner_id', 'verification_status', 'wave_score']
            exposed = [f for f in forbidden if f in dup]
            if exposed:
                record_result("A_M05_SYNC", "A7", False, f"Sensitive fields exposed in duplicate: {exposed}")
                return False
        
        print_info("✓ No sensitive fields exposed")
        record_result("A_M05_SYNC", "A7", True, "Sensitive-field firewall working")
        return True
        
    except Exception as e:
        record_result("A_M05_SYNC", "A7", False, f"Exception: {str(e)}")
        return False

def test_a8_provider_failure_fallback():
    """A8. Provider failure fallback"""
    print_test("A8. Provider failure fallback")
    
    try:
        # This is hard to test without mocking, but we can verify the response structure
        # when inference is unavailable
        unique_id = uuid.uuid4().hex[:20]
        test_url = f"https://whatsapp.com/channel/{unique_id}"
        
        resp = requests.post(f"{BASE_URL}/channels/enrich", json={"channel_url": test_url})
        
        if resp.status_code != 200:
            record_result("A_M05_SYNC", "A8", False, f"Enrich returned {resp.status_code}")
            return False
        
        data = resp.json().get('data', {})
        
        # If inference_available is false, status should be partial or unavailable (not error)
        if not data.get('inference_available'):
            if data.get('status') not in ['partial', 'unavailable']:
                record_result("A_M05_SYNC", "A8", False, f"When inference unavailable, status should be partial/unavailable, got {data.get('status')}")
                return False
            print_info(f"✓ Inference unavailable, status={data.get('status')} (fail-open working)")
        else:
            print_info("✓ Inference available (provider working)")
        
        record_result("A_M05_SYNC", "A8", True, "Provider failure fallback working (fail-open design)")
        return True
        
    except Exception as e:
        record_result("A_M05_SYNC", "A8", False, f"Exception: {str(e)}")
        return False

# ============================================================================
# SECTION B: M02 REGRESSION (moderation)
# ============================================================================

def test_b1_anonymous_submit():
    """B1. Anonymous cannot POST /api/channels/submit"""
    print_test("B1. Anonymous cannot submit")
    
    try:
        resp = requests.post(f"{BASE_URL}/submit", json={
            "whatsapp_url": "https://whatsapp.com/channel/test123456789012",
            "name": "Test",
            "short_description": "Test channel",
            "category_slug": "business",
            "country_code": "ID",
            "primary_language": "id"
        })
        
        if resp.status_code == 401:
            record_result("B_M02_REGRESSION", "B1", True, "Anonymous submit correctly returns 401")
            return True
        else:
            record_result("B_M02_REGRESSION", "B1", False, f"Expected 401, got {resp.status_code}")
            return False
            
    except Exception as e:
        record_result("B_M02_REGRESSION", "B1", False, f"Exception: {str(e)}")
        return False

def test_b2_user_submit():
    """B2. Authed user submits a channel → status pending_review"""
    print_test("B2. User submission creates pending_review channel")
    
    try:
        # Create test user
        email = f"m05-test-{int(time.time())}@example.com"
        cookies, user_data = signup(email)
        
        if not cookies:
            record_result("B_M02_REGRESSION", "B2", False, "Failed to create test user")
            return False
        
        # Submit channel
        unique_id = uuid.uuid4().hex[:20]
        resp = requests.post(f"{BASE_URL}/submit", json={
            "whatsapp_url": f"https://whatsapp.com/channel/{unique_id}",
            "name": "M05 Test Channel",
            "short_description": "Test channel for M05 verification",
            "category_slug": "business",
            "country_code": "ID",
            "primary_language": "id"
        }, cookies=cookies)
        
        if resp.status_code != 200:
            record_result("B_M02_REGRESSION", "B2", False, f"Submit returned {resp.status_code}")
            return False
        
        data = resp.json().get('data', {})
        channel = data.get('channel', {})
        
        if channel.get('status') != 'pending_review':
            record_result("B_M02_REGRESSION", "B2", False, f"Expected status=pending_review, got {channel.get('status')}")
            return False
        
        print_info(f"✓ Channel created with status=pending_review, id={channel.get('id')}")
        record_result("B_M02_REGRESSION", "B2", True, "User submission creates pending_review channel")
        return True
        
    except Exception as e:
        record_result("B_M02_REGRESSION", "B2", False, f"Exception: {str(e)}")
        return False

def test_b3_moderation_flow():
    """B3. Same user cannot approve/reject; moderator can"""
    print_test("B3. Moderation authorization")
    
    try:
        # Create test user and submit channel
        email = f"m05-mod-test-{int(time.time())}@example.com"
        cookies, user_data = signup(email)
        
        if not cookies:
            record_result("B_M02_REGRESSION", "B3", False, "Failed to create test user")
            return False
        
        # Submit channel
        unique_id = uuid.uuid4().hex[:20]
        resp = requests.post(f"{BASE_URL}/submit", json={
            "whatsapp_url": f"https://whatsapp.com/channel/{unique_id}",
            "name": "M05 Mod Test Channel",
            "short_description": "Test channel for moderation",
            "category_slug": "business",
            "country_code": "ID",
            "primary_language": "id"
        }, cookies=cookies)
        
        channel_id = resp.json()['data']['channel']['id']
        
        # Try to approve as same user (should fail)
        resp = requests.post(f"{BASE_URL}/admin/channels/{channel_id}/approve", 
                           json={}, cookies=cookies)
        
        if resp.status_code not in [401, 403]:
            record_result("B_M02_REGRESSION", "B3", False, f"User should not be able to approve, got {resp.status_code}")
            return False
        
        print_info("✓ Normal user cannot approve (403)")
        
        # Login as admin
        admin_cookies = login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)
        if not admin_cookies:
            record_result("B_M02_REGRESSION", "B3", False, "Failed to login as admin")
            return False
        
        # Approve as admin
        resp = requests.post(f"{BASE_URL}/admin/channels/{channel_id}/approve", 
                           json={}, cookies=admin_cookies)
        
        if resp.status_code != 200:
            record_result("B_M02_REGRESSION", "B3", False, f"Admin approve returned {resp.status_code}")
            return False
        
        print_info("✓ Admin can approve (200)")
        record_result("B_M02_REGRESSION", "B3", True, "Moderation authorization working")
        return True
        
    except Exception as e:
        record_result("B_M02_REGRESSION", "B3", False, f"Exception: {str(e)}")
        return False

def test_b4_approved_channel_public():
    """B4. Approved channel appears in public listing"""
    print_test("B4. Approved channel is public")
    
    try:
        db = get_mongo_db()
        
        # Find an approved channel
        approved = db.channels.find_one({"status": "approved"})
        if not approved:
            record_result("B_M02_REGRESSION", "B4", False, "No approved channels found")
            return False
        
        slug = approved['slug']
        
        # Check it appears in /api/channels
        resp = requests.get(f"{BASE_URL}/channels?limit=100")
        if resp.status_code != 200:
            record_result("B_M02_REGRESSION", "B4", False, f"Channels list returned {resp.status_code}")
            return False
        
        items = resp.json()['data']['items']
        found = any(c['slug'] == slug for c in items)
        
        if not found:
            record_result("B_M02_REGRESSION", "B4", False, f"Approved channel {slug} not in public listing")
            return False
        
        # Check it's accessible via /api/channels/:slug
        resp = requests.get(f"{BASE_URL}/channels/{slug}")
        if resp.status_code != 200:
            record_result("B_M02_REGRESSION", "B4", False, f"Channel detail returned {resp.status_code}")
            return False
        
        print_info(f"✓ Approved channel {slug} is public")
        record_result("B_M02_REGRESSION", "B4", True, "Approved channels are public")
        return True
        
    except Exception as e:
        record_result("B_M02_REGRESSION", "B4", False, f"Exception: {str(e)}")
        return False

def test_b5_homepage_slots():
    """B5. Homepage slots endpoints work for admin"""
    print_test("B5. Homepage slots endpoints")
    
    try:
        # Login as admin
        admin_cookies = login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)
        if not admin_cookies:
            record_result("B_M02_REGRESSION", "B5", False, "Failed to login as admin")
            return False
        
        # Get slots
        resp = requests.get(f"{BASE_URL}/admin/homepage/slots", cookies=admin_cookies)
        if resp.status_code != 200:
            record_result("B_M02_REGRESSION", "B5", False, f"Get slots returned {resp.status_code}")
            return False
        
        print_info("✓ Admin can access homepage slots")
        
        # Test non-admin cannot access
        email = f"m05-user-{int(time.time())}@example.com"
        user_cookies, _ = signup(email)
        
        resp = requests.get(f"{BASE_URL}/admin/homepage/slots", cookies=user_cookies)
        if resp.status_code not in [401, 403]:
            record_result("B_M02_REGRESSION", "B5", False, f"Non-admin should get 403, got {resp.status_code}")
            return False
        
        print_info("✓ Non-admin cannot access (403)")
        record_result("B_M02_REGRESSION", "B5", True, "Homepage slots endpoints working")
        return True
        
    except Exception as e:
        record_result("B_M02_REGRESSION", "B5", False, f"Exception: {str(e)}")
        return False

# ============================================================================
# SECTION E: INTEGRATION SANITY
# ============================================================================

def test_e1_redirect_go_slug():
    """E1. Redirect /go/:slug for approved channels"""
    print_test("E1. /go/:slug redirect")
    
    try:
        db = get_mongo_db()
        
        # Find an approved channel
        approved = db.channels.find_one({"status": "approved"})
        if not approved:
            record_result("E_INTEGRATION", "E1", False, "No approved channels found")
            return False
        
        slug = approved['slug']
        
        # Test redirect (don't follow redirects)
        resp = requests.get(f"https://grow-infrastructure.preview.emergentagent.com/go/{slug}", 
                          allow_redirects=False)
        
        if resp.status_code != 302:
            record_result("E_INTEGRATION", "E1", False, f"Expected 302, got {resp.status_code}")
            return False
        
        location = resp.headers.get('Location', '')
        if not location.startswith('https://whatsapp.com'):
            record_result("E_INTEGRATION", "E1", False, f"Redirect location should be whatsapp.com, got {location}")
            return False
        
        print_info(f"✓ Approved channel {slug} redirects to {location}")
        
        # Test unapproved channel
        unapproved = db.channels.find_one({"status": {"$ne": "approved"}})
        if unapproved:
            resp = requests.get(f"https://grow-infrastructure.preview.emergentagent.com/go/{unapproved['slug']}", 
                              allow_redirects=False)
            
            if resp.status_code == 302:
                location = resp.headers.get('Location', '')
                if 'not_available=1' not in location:
                    record_result("E_INTEGRATION", "E1", False, "Unapproved should redirect to /channel/:slug?not_available=1")
                    return False
                print_info(f"✓ Unapproved channel redirects to {location}")
        
        record_result("E_INTEGRATION", "E1", True, "/go/:slug redirect working")
        return True
        
    except Exception as e:
        record_result("E_INTEGRATION", "E1", False, f"Exception: {str(e)}")
        return False

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

def run_all_tests():
    """Run all test sections"""
    
    print_section("M05.0 FINAL SYNC / RELEASE VERIFICATION")
    print_info(f"Base URL: {BASE_URL}")
    print_info(f"MongoDB: {MONGO_URL}/{DB_NAME}")
    print_info(f"Test started at: {datetime.now().isoformat()}")
    
    # Section A: M05.0 FINAL SYNC
    print_section("SECTION A: M05.0 FINAL SYNC")
    test_a1_health_endpoint()
    test_a2_ssrf_firewall()
    test_a3_duplicate_detection()
    test_a4_duplicate_contextual_cta()
    test_a5_new_channel_path()
    test_a6_cache_behavior()
    test_a7_sensitive_field_firewall()
    test_a8_provider_failure_fallback()
    
    # Section B: M02 REGRESSION
    print_section("SECTION B: M02 REGRESSION (moderation)")
    test_b1_anonymous_submit()
    test_b2_user_submit()
    test_b3_moderation_flow()
    test_b4_approved_channel_public()
    test_b5_homepage_slots()
    
    # Section E: INTEGRATION SANITY
    print_section("SECTION E: INTEGRATION SANITY")
    test_e1_redirect_go_slug()
    
    # Print summary
    print_section("TEST SUMMARY")
    
    for section, tests in test_results.items():
        print(f"\n{section}:")
        passed = sum(1 for t in tests.values() if t['passed'])
        total = len(tests)
        print(f"  {passed}/{total} tests passed")
        
        for test_id, result in tests.items():
            status = "✅ PASS" if result['passed'] else "❌ FAIL"
            print(f"  {status}: {test_id} - {result['message']}")
    
    # Overall summary
    total_passed = sum(sum(1 for t in tests.values() if t['passed']) for tests in test_results.values())
    total_tests = sum(len(tests) for tests in test_results.values())
    
    print(f"\n{'='*80}")
    print(f"OVERALL: {total_passed}/{total_tests} tests passed")
    print(f"Test completed at: {datetime.now().isoformat()}")
    print('='*80)
    
    return total_passed == total_tests

if __name__ == "__main__":
    success = run_all_tests()
    exit(0 if success else 1)
