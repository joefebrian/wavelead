#!/usr/bin/env python3
"""
Check 6: Live-role authorization test
This test verifies that role changes in the DB take immediate effect
"""

import requests
import time
from pymongo import MongoClient
import os

BASE_URL = "http://localhost:3000"

def extract_cookie(response, cookie_name="wl_session"):
    """Extract cookie value from Set-Cookie header"""
    set_cookie = response.headers.get('Set-Cookie', '')
    if cookie_name in set_cookie:
        for part in set_cookie.split(';'):
            if cookie_name in part:
                return part.strip()
    return None

print("=" * 80)
print("CHECK 6: Live-Role Authorization (CRITICAL)")
print("=" * 80)

try:
    mongo_url = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
    client = MongoClient(mongo_url)
    db = client['wavelead']  # Use live DB
    
    # Create a unique test user
    timestamp = int(time.time())
    test_email = f"roletest+{timestamp}@wavelead.test"
    
    # Step 1: Signup as regular user
    print("\n1. Creating regular user...")
    resp = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={
            "email": test_email,
            "password": "password123",
            "display_name": "Role Test User"
        }
    )
    
    if resp.status_code != 200:
        print(f"❌ FAIL: Signup failed with status {resp.status_code}")
        print(f"Response: {resp.text}")
        exit(1)
    
    data = resp.json()
    user_id = data.get('data', {}).get('user', {}).get('id', '')
    role = data.get('data', {}).get('user', {}).get('role', '')
    cookie = extract_cookie(resp, "wl_session")
    
    print(f"✅ User created: {test_email}, role={role}, user_id={user_id}")
    
    # Step 2: Verify user cannot access admin endpoint
    print("\n2. Verifying user cannot access /api/admin/ping...")
    resp = requests.get(
        f"{BASE_URL}/api/admin/ping",
        headers={"Cookie": cookie}
    )
    
    if resp.status_code == 403:
        print(f"✅ PASS: User correctly denied (403)")
    else:
        print(f"❌ FAIL: Expected 403, got {resp.status_code}")
    
    # Step 3: Manually promote user to super_admin in DB
    print("\n3. Promoting user to super_admin in DB...")
    result = db.users.update_one(
        {"id": user_id},
        {"$set": {"role": "super_admin"}}
    )
    
    if result.modified_count == 1:
        print(f"✅ User promoted to super_admin in DB")
    else:
        print(f"❌ FAIL: Failed to update user role in DB")
        exit(1)
    
    # Step 4: Verify SAME cookie now grants access
    print("\n4. Verifying SAME cookie now grants access...")
    resp = requests.get(
        f"{BASE_URL}/api/admin/ping",
        headers={"Cookie": cookie}
    )
    data = resp.json()
    api_role = data.get('data', {}).get('role', '')
    
    if resp.status_code == 200 and api_role == "super_admin":
        print(f"✅ PASS: Same cookie now grants access (200), role={api_role}")
    else:
        print(f"❌ FAIL: Expected 200 with role=super_admin, got {resp.status_code}, role={api_role}")
    
    # Step 5: Downgrade user back to regular user in DB
    print("\n5. Downgrading user back to 'user' in DB...")
    result = db.users.update_one(
        {"id": user_id},
        {"$set": {"role": "user"}}
    )
    
    if result.modified_count == 1:
        print(f"✅ User downgraded to 'user' in DB")
    else:
        print(f"❌ FAIL: Failed to downgrade user role in DB")
        exit(1)
    
    # Step 6: CRITICAL - Verify SAME cookie is now denied
    print("\n6. CRITICAL: Verifying SAME cookie is now denied...")
    resp = requests.get(
        f"{BASE_URL}/api/admin/ping",
        headers={"Cookie": cookie}
    )
    
    if resp.status_code == 403:
        print(f"✅ PASS: CRITICAL TEST PASSED - Same cookie denied after downgrade (403)")
        print(f"   This proves authorization reads CURRENT DB role, not stale JWT role")
    else:
        print(f"❌ FAIL: CRITICAL TEST FAILED - Expected 403, got {resp.status_code}")
        print(f"   This means authorization is using stale JWT role instead of current DB role")
    
    # Step 7: Verify unauthenticated request returns 401
    print("\n7. Verifying unauthenticated request returns 401...")
    resp = requests.get(f"{BASE_URL}/api/admin/ping")
    
    if resp.status_code == 401:
        print(f"✅ PASS: Unauthenticated request returns 401")
    else:
        print(f"❌ FAIL: Expected 401, got {resp.status_code}")
    
    # Cleanup: Delete test user
    print(f"\n8. Cleaning up test user...")
    db.users.delete_one({"id": user_id})
    print(f"✅ Test user deleted")
    
    client.close()
    
    print("\n" + "=" * 80)
    print("CHECK 6 COMPLETE")
    print("=" * 80)

except Exception as e:
    print(f"\n❌ FAIL: Exception occurred: {str(e)}")
    import traceback
    traceback.print_exc()
    exit(1)
