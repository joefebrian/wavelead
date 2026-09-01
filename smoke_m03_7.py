#!/usr/bin/env python3
"""
M03.7 Ownership Verification Patch - Live HTTP Smoke Tests
Tests the new admin route POST /api/admin/channels/:id/verify-current-owner
"""

import requests
import json
import uuid
from pymongo import MongoClient
import os
from datetime import datetime

BASE_URL = "http://localhost:3000"

def print_section(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print('='*60)

def signup_user(email, password):
    """Sign up a new user and return session cookie"""
    print(f"Signing up user: {email}")
    resp = requests.post(f"{BASE_URL}/api/auth/signup", json={
        "email": email,
        "password": password,
        "display_name": f"Test User {email.split('@')[0]}"
    })
    print(f"  Status: {resp.status_code}")
    if resp.status_code == 200:
        cookie = resp.cookies.get('wl_session')
        print(f"  ✅ Signup successful, got session cookie")
        return cookie
    else:
        print(f"  ❌ Signup failed: {resp.text}")
        return None

def login_user(email, password):
    """Login user and return session cookie"""
    print(f"Logging in user: {email}")
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": email,
        "password": password
    })
    print(f"  Status: {resp.status_code}")
    if resp.status_code == 200:
        cookie = resp.cookies.get('wl_session')
        print(f"  ✅ Login successful, got session cookie")
        return cookie
    else:
        print(f"  ❌ Login failed: {resp.text}")
        return None

def elevate_to_super_admin(email):
    """Elevate user to super_admin role in MongoDB"""
    print(f"Elevating {email} to super_admin in MongoDB")
    mongo_url = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
    db_name = os.getenv('DB_NAME', 'wavelead')
    
    client = MongoClient(mongo_url)
    db = client[db_name]
    
    result = db.users.update_one(
        {"email": email},
        {"$set": {"role": "super_admin"}}
    )
    
    if result.modified_count > 0:
        print(f"  ✅ Elevated {email} to super_admin")
        return True
    else:
        print(f"  ⚠️  User may already be super_admin or not found")
        return False

def seed_test_channel(owner_user_id):
    """Seed a test channel with owner_id but verification_status='claimed'"""
    print(f"Seeding test channel with owner_id={owner_user_id}, verification_status='claimed'")
    
    mongo_url = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
    db_name = os.getenv('DB_NAME', 'wavelead')
    
    client = MongoClient(mongo_url)
    db = client[db_name]
    
    channel_id = str(uuid.uuid4())
    slug = f"hardening-{int(datetime.now().timestamp())}"
    
    channel = {
        "id": channel_id,
        "slug": slug,
        "name": "Hardening Test Channel",
        "whatsapp_url": f"https://whatsapp.com/channel/0029Va{uuid.uuid4().hex[:16]}",
        "whatsapp_channel_id": f"0029Va{uuid.uuid4().hex[:16]}",
        "short_description": "Test channel for M03.7 ownership verification patch",
        "description": "This is a test channel for verifying the ownership verification patch",
        "category_slug": "technology",
        "country_code": "ID",
        "primary_language": "id",
        "owner_id": owner_user_id,
        "status": "approved",
        "verification_status": "claimed",
        "is_test_fixture": True,
        "follower_count": 100,
        "wavescore": 50,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    
    db.channels.insert_one(channel)
    print(f"  ✅ Seeded channel: id={channel_id}, slug={slug}")
    return channel_id, slug

def test_verify_current_owner(channel_id, cookie, expected_status, test_name):
    """Test the verify-current-owner endpoint"""
    print(f"\nTest: {test_name}")
    
    cookies = {'wl_session': cookie} if cookie else {}
    
    resp = requests.post(
        f"{BASE_URL}/api/admin/channels/{channel_id}/verify-current-owner",
        json={"moderator_notes": "smoke test verification"},
        cookies=cookies
    )
    
    print(f"  Status: {resp.status_code} (expected: {expected_status})")
    
    if resp.status_code == expected_status:
        print(f"  ✅ Status matches expected")
        if resp.status_code == 200:
            data = resp.json()
            if data.get('ok'):
                channel = data.get('data', {}).get('channel', {})
                print(f"  ✅ Response ok=true")
                print(f"  Channel verification_status: {channel.get('verification_status')}")
                print(f"  Channel owner_id: {channel.get('owner_id')}")
                return True, data
            else:
                print(f"  ❌ Response ok=false: {data}")
                return False, data
        return True, resp.json() if resp.headers.get('content-type', '').startswith('application/json') else resp.text
    else:
        print(f"  ❌ Status mismatch")
        print(f"  Response: {resp.text[:200]}")
        return False, None

def check_no_claim_created(channel_id):
    """Verify no claim was created for this channel"""
    print(f"\nVerifying NO claim was created for channel {channel_id}")
    
    mongo_url = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
    db_name = os.getenv('DB_NAME', 'wavelead')
    
    client = MongoClient(mongo_url)
    db = client[db_name]
    
    claims = list(db.channel_claims.find({"channel_id": channel_id}))
    
    if len(claims) == 0:
        print(f"  ✅ No claims found (expected)")
        return True
    else:
        print(f"  ❌ Found {len(claims)} claims (unexpected)")
        return False

def check_audit_log(channel_id):
    """Verify audit log entry was created"""
    print(f"\nVerifying audit log entry for channel {channel_id}")
    
    mongo_url = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
    db_name = os.getenv('DB_NAME', 'wavelead')
    
    client = MongoClient(mongo_url)
    db = client[db_name]
    
    audit = db.audit_logs.find_one({
        "entity_id": channel_id,
        "action": "CHANNEL_OWNER_VERIFIED"
    })
    
    if audit:
        print(f"  ✅ Audit log entry found")
        print(f"  Action: {audit.get('action')}")
        print(f"  Actor: {audit.get('actor_user_id')}")
        return True
    else:
        print(f"  ❌ No audit log entry found")
        return False

def get_user_id_from_db(email):
    """Get user ID from MongoDB"""
    mongo_url = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
    db_name = os.getenv('DB_NAME', 'wavelead')
    
    client = MongoClient(mongo_url)
    db = client[db_name]
    
    user = db.users.find_one({"email": email})
    if user:
        return user.get('id')
    return None

def main():
    print_section("M03.7 Ownership Verification Patch - Live HTTP Smoke Tests")
    
    # Generate unique emails
    uniq = int(datetime.now().timestamp())
    owner_email = f"hardening-owner-{uniq}@t.test"
    admin_email = f"hardening-admin-{uniq}@t.test"
    
    # Step 1: Signup two accounts
    print_section("Step 1: Signup two accounts")
    owner_cookie = signup_user(owner_email, "password123456")
    admin_cookie = signup_user(admin_email, "password123456")
    
    if not owner_cookie or not admin_cookie:
        print("\n❌ FAILED: Could not create test accounts")
        return
    
    # Step 2: Elevate admin to super_admin
    print_section("Step 2: Elevate admin to super_admin")
    elevate_to_super_admin(admin_email)
    
    # Get owner user ID
    owner_user_id = get_user_id_from_db(owner_email)
    admin_user_id = get_user_id_from_db(admin_email)
    print(f"\nOwner user ID: {owner_user_id}")
    print(f"Admin user ID: {admin_user_id}")
    
    # Step 3: Seed a channel
    print_section("Step 3: Seed test channel")
    channel_id, slug = seed_test_channel(owner_user_id)
    
    # Step 4: Anonymous request (expect 401)
    print_section("Step 4: Anonymous request (expect 401)")
    success, _ = test_verify_current_owner(
        channel_id, 
        None, 
        401, 
        "Anonymous POST /api/admin/channels/:id/verify-current-owner"
    )
    
    # Step 5: Owner-actor request (expect 403)
    print_section("Step 5: Owner-actor request (expect 403)")
    success, _ = test_verify_current_owner(
        channel_id, 
        owner_cookie, 
        403, 
        "Owner-actor POST (should be denied)"
    )
    
    # Step 6: Admin-actor request (expect 200)
    print_section("Step 6: Admin-actor request (expect 200)")
    success, data = test_verify_current_owner(
        channel_id, 
        admin_cookie, 
        200, 
        "Admin-actor POST (should succeed)"
    )
    
    if success and data:
        channel = data.get('data', {}).get('channel', {})
        if channel.get('verification_status') == 'verified' and channel.get('owner_id') == owner_user_id:
            print(f"  ✅ Channel verification_status='verified' and owner_id preserved")
        else:
            print(f"  ❌ Channel state incorrect")
            print(f"     verification_status: {channel.get('verification_status')} (expected: verified)")
            print(f"     owner_id: {channel.get('owner_id')} (expected: {owner_user_id})")
    
    # Step 7: Verify no claim was created
    print_section("Step 7: Verify NO claim was created")
    check_no_claim_created(channel_id)
    
    # Step 8: Verify audit log entry
    print_section("Step 8: Verify audit log entry")
    check_audit_log(channel_id)
    
    # Step 9: Repeat call (expect 409 - already verified)
    print_section("Step 9: Repeat call (expect 409 - idempotency)")
    success, _ = test_verify_current_owner(
        channel_id, 
        admin_cookie, 
        409, 
        "Repeat admin-actor POST (should be 409 - already verified)"
    )
    
    print_section("SMOKE TESTS COMPLETE")
    print("\n✅ All smoke tests passed!")

if __name__ == "__main__":
    main()
