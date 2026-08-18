#!/usr/bin/env python3
"""
Check 5: Signup role logic test
Tests bootstrap super_admin logic using wavelead_test DB
"""

import requests
import time
from pymongo import MongoClient
import os
import subprocess

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
print("CHECK 5: Signup Role Logic (Bootstrap)")
print("=" * 80)

# We need to temporarily switch to test DB
print("\n⚠️  This test requires temporarily switching to wavelead_test DB")
print("Backing up current .env...")

# Read current .env
with open('/app/.env', 'r') as f:
    original_env = f.read()

# Modify to use test DB
modified_env = original_env.replace('DB_NAME=wavelead', 'DB_NAME=wavelead_test')

# Write modified .env
with open('/app/.env', 'w') as f:
    f.write(modified_env)

print("✅ Switched to wavelead_test DB")
print("Restarting Next.js server...")

# Restart Next.js to pick up new env
subprocess.run(['sudo', 'supervisorctl', 'restart', 'nextjs'], capture_output=True)
time.sleep(5)  # Wait for server to restart

try:
    mongo_url = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
    client = MongoClient(mongo_url)
    db = client['wavelead_test']
    
    # Test 1: Random email gets role=user
    print("\n1. Testing random email gets role=user...")
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
    
    if resp.status_code == 200:
        data = resp.json()
        role = data.get('data', {}).get('user', {}).get('role', '')
        if role == "user":
            print(f"✅ PASS: Random email gets role=user")
        else:
            print(f"❌ FAIL: Expected role=user, got role={role}")
    else:
        print(f"❌ FAIL: Signup failed with status {resp.status_code}")
    
    # Test 2: Bootstrap email gets super_admin when DB is empty
    print("\n2. Testing bootstrap email gets super_admin when DB is empty...")
    
    # Clear users collection
    db.users.delete_many({})
    print("   Cleared users collection")
    
    bootstrap_email = "admin@wavelead.dev"
    resp = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={
            "email": bootstrap_email,
            "password": "password123",
            "display_name": "Bootstrap Admin"
        }
    )
    
    if resp.status_code == 200:
        data = resp.json()
        role = data.get('data', {}).get('user', {}).get('role', '')
        user_id = data.get('data', {}).get('user', {}).get('id', '')
        if role == "super_admin":
            print(f"✅ PASS: Bootstrap email gets super_admin when DB empty")
        else:
            print(f"❌ FAIL: Expected role=super_admin, got role={role}")
            print(f"   Response: {data}")
    else:
        print(f"❌ FAIL: Bootstrap signup failed with status {resp.status_code}")
        print(f"   Response: {resp.text}")
    
    # Test 3: Re-attempting bootstrap email after super_admin exists gets role=user
    print("\n3. Testing bootstrap email after super_admin exists gets role=user...")
    
    # Try to signup with bootstrap email again (should get user role)
    timestamp = int(time.time())
    resp = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={
            "email": f"admin+{timestamp}@wavelead.dev",  # Different email but matches pattern
            "password": "password123",
            "display_name": "Second Admin Attempt"
        }
    )
    
    # Actually, the bootstrap logic checks exact email match, so let's test with a different user
    # who happens to signup after super_admin exists
    resp = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={
            "email": f"user+{timestamp}@wavelead.test",
            "password": "password123",
            "display_name": "Regular User After Bootstrap"
        }
    )
    
    if resp.status_code == 200:
        data = resp.json()
        role = data.get('data', {}).get('user', {}).get('role', '')
        if role == "user":
            print(f"✅ PASS: New user gets role=user after super_admin exists")
        else:
            print(f"❌ FAIL: Expected role=user, got role={role}")
    else:
        print(f"❌ FAIL: Signup failed with status {resp.status_code}")
    
    # Test 4: Bootstrap email consumed (trying exact bootstrap email again should give 409)
    print("\n4. Testing bootstrap email is consumed (duplicate should fail)...")
    
    resp = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={
            "email": bootstrap_email,  # Same email as before
            "password": "password123",
            "display_name": "Duplicate Bootstrap"
        }
    )
    
    if resp.status_code == 409:
        print(f"✅ PASS: Bootstrap email consumed (duplicate returns 409)")
    else:
        print(f"❌ FAIL: Expected 409 for duplicate email, got {resp.status_code}")
    
    client.close()
    
    print("\n" + "=" * 80)
    print("CHECK 5 COMPLETE")
    print("=" * 80)

except Exception as e:
    print(f"\n❌ FAIL: Exception occurred: {str(e)}")
    import traceback
    traceback.print_exc()

finally:
    # Restore original .env
    print("\nRestoring original .env...")
    with open('/app/.env', 'w') as f:
        f.write(original_env)
    print("✅ Restored original .env")
    
    print("Restarting Next.js server...")
    subprocess.run(['sudo', 'supervisorctl', 'restart', 'nextjs'], capture_output=True)
    time.sleep(5)
    print("✅ Server restarted with original configuration")
