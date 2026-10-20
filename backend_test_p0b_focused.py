#!/usr/bin/env python3
"""
P0B Backend API Testing - Focused Critical Path Tests
Reuses login sessions to avoid rate limiting
"""

import requests
import json
import time

BASE_URL = "http://localhost:3000/api"
QA_PASSWORD = "P0bWave!2026Qa"

test_results = []

def log_test(name: str, passed: bool, details: str = ""):
    status = "✅ PASS" if passed else "❌ FAIL"
    result = f"{status}: {name}"
    if details:
        result += f"\n    {details}"
    print(result)
    test_results.append({"name": name, "passed": passed, "details": details})

def login_all():
    """Login all users once and return cookies"""
    print("Logging in all QA users...")
    cookies = {}
    
    for role, email in [("admin", "qa-p0b-admin@wavelead.dev"), 
                        ("agent", "qa-p0b-agent@wavelead.dev"),
                        ("owner", "qa-p0b-owner@wavelead.dev")]:
        resp = requests.post(f"{BASE_URL}/auth/login",
                           json={"email": email, "password": QA_PASSWORD}, timeout=10)
        if resp.status_code == 200:
            cookies[role] = resp.cookies.get("wl_session")
            print(f"  ✓ {role} logged in")
        else:
            print(f"  ✗ {role} login failed: {resp.status_code}")
            return None
    
    return cookies

def get_user_id(cookie):
    """Get user ID from /auth/me"""
    resp = requests.get(f"{BASE_URL}/auth/me", 
                       headers={"Cookie": f"wl_session={cookie}"}, timeout=10)
    if resp.status_code == 200:
        data = resp.json()
        return data.get("data", {}).get("user", {}).get("id")
    return None

def main():
    print("="*70)
    print("P0B BACKEND API TESTING - FOCUSED CRITICAL PATH")
    print("="*70)
    
    # Login once
    cookies = login_all()
    if not cookies:
        print("\n❌ FATAL: Failed to login QA users")
        return
    
    # Get user IDs
    print("\nGetting user IDs...")
    admin_id = get_user_id(cookies["admin"])
    agent_id = get_user_id(cookies["agent"])
    owner_id = get_user_id(cookies["owner"])
    
    if not all([admin_id, agent_id, owner_id]):
        print("❌ FATAL: Failed to get user IDs")
        return
    
    print(f"  Admin ID: {admin_id[:8]}...")
    print(f"  Agent ID: {agent_id[:8]}...")
    print(f"  Owner ID: {owner_id[:8]}...")
    
    # TEST 1: Public health endpoint
    print("\n=== TEST 1: PUBLIC HEALTH ENDPOINT ===")
    resp = requests.get(f"{BASE_URL}/health", timeout=10)
    if resp.status_code == 200:
        data = resp.json().get("data", {})
        has_safe_fields = all(f in data for f in ["status", "service"])
        has_forbidden = any(f in data for f in ["commit", "version", "branch", "build_time"])
        
        log_test("Health - Has safe fields only", has_safe_fields and not has_forbidden,
                f"Fields: {list(data.keys())}")
    else:
        log_test("Health - Accessible", False, f"Got {resp.status_code}")
    
    # TEST 2: Authorization on P0B endpoints
    print("\n=== TEST 2: AUTHORIZATION ===")
    
    # Anonymous should be denied
    resp = requests.get(f"{BASE_URL}/admin/diagnostics/build", timeout=10)
    log_test("Auth - Build diagnostics anonymous denied", resp.status_code in [401, 403],
            f"Got {resp.status_code}")
    
    # Ordinary user should be denied
    resp = requests.get(f"{BASE_URL}/admin/diagnostics/build",
                       headers={"Cookie": f"wl_session={cookies['owner']}"}, timeout=10)
    log_test("Auth - Build diagnostics user denied", resp.status_code == 403,
            f"Got {resp.status_code}")
    
    # Admin should be allowed
    resp = requests.get(f"{BASE_URL}/admin/diagnostics/build",
                       headers={"Cookie": f"wl_session={cookies['admin']}"}, timeout=10)
    log_test("Auth - Build diagnostics admin allowed", resp.status_code == 200,
            f"Got {resp.status_code}")
    
    # TEST 3: Metrics
    print("\n=== TEST 3: CLAIM-PATH METRICS ===")
    resp = requests.get(f"{BASE_URL}/admin/operations/metrics",
                       headers={"Cookie": f"wl_session={cookies['admin']}"}, timeout=10)
    
    if resp.status_code == 200:
        response_data = resp.json()
        metrics = response_data.get("data", response_data)
        required = ["public_approved_total", "claimable", "linked_unverified", 
                   "verified_ownership", "needs_review", "sum_matches_total"]
        has_all = all(f in metrics for f in required)
        
        log_test("Metrics - All fields present", has_all, f"Fields: {list(metrics.keys())}")
        
        if has_all:
            total = metrics["public_approved_total"]
            sum_buckets = (metrics["claimable"] + metrics["linked_unverified"] + 
                          metrics["verified_ownership"] + metrics["needs_review"])
            
            log_test("Metrics - sum_matches_total correct", 
                    metrics["sum_matches_total"] == (sum_buckets == total),
                    f"Total={total}, Sum={sum_buckets}, Flag={metrics['sum_matches_total']}")
    else:
        log_test("Metrics - Fetch", False, f"Got {resp.status_code}")
    
    # TEST 4: Snapshots
    print("\n=== TEST 4: INVENTORY SNAPSHOTS ===")
    release_key = f"test-p0b-{int(time.time())}"
    
    # Capture pre_deploy
    resp = requests.post(f"{BASE_URL}/admin/operations/snapshots",
                        headers={"Cookie": f"wl_session={cookies['admin']}"},
                        json={"phase": "pre_deploy", "release_key": release_key,
                             "note": "P0B test snapshot"},
                        timeout=10)
    
    if resp.status_code == 200:
        response_data = resp.json()
        data = response_data.get("data", response_data)
        log_test("Snapshots - Capture succeeds", data.get("created") == True,
                f"created={data.get('created')}")
        
        # Idempotency test
        resp2 = requests.post(f"{BASE_URL}/admin/operations/snapshots",
                             headers={"Cookie": f"wl_session={cookies['admin']}"},
                             json={"phase": "pre_deploy", "release_key": release_key},
                             timeout=10)
        if resp2.status_code == 200:
            data2 = resp2.json().get("data", resp2.json())
            log_test("Snapshots - Idempotent", data2.get("created") == False,
                    f"Second created={data2.get('created')}")
        
        # Check snapshot structure
        snapshot = data.get("snapshot", {})
        has_metrics = "metrics" in snapshot
        no_channels = "channels" not in str(snapshot) and "items" not in str(snapshot)
        
        log_test("Snapshots - Aggregate only", has_metrics and no_channels,
                f"Has metrics: {has_metrics}, No channel list: {no_channels}")
    else:
        log_test("Snapshots - Capture", False, f"Got {resp.status_code}")
    
    # TEST 5: Staff-sourced submission
    print("\n=== TEST 5: STAFF-SOURCED SUBMISSION ===")
    
    timestamp = int(time.time())
    
    # Agent submission
    agent_channel = {
        "whatsapp_url": f"https://whatsapp.com/channel/0029VaP0bAgent{timestamp}",
        "name": f"Agent Sourced {timestamp}",
        "short_description": "Test channel sourced by agent - owner_id should be NULL",
        "category_slug": "business",
        "country_code": "ID",
        "primary_language": "id"
    }
    
    resp = requests.post(f"{BASE_URL}/submit",
                        headers={"Cookie": f"wl_session={cookies['agent']}"},
                        json=agent_channel, timeout=10)
    
    if resp.status_code == 200:
        response_data = resp.json()
        agent_channel_id = response_data.get("data", {}).get("channel", {}).get("id")
        
        # Verify via admin endpoint
        resp2 = requests.get(f"{BASE_URL}/admin/channels/{agent_channel_id}",
                            headers={"Cookie": f"wl_session={cookies['admin']}"}, timeout=10)
        
        if resp2.status_code == 200:
            response_data2 = resp2.json()
            channel = response_data2.get("data", {}).get("channel", response_data2.get("channel", {}))
            
            log_test("Staff-sourced - owner_id is NULL", channel.get("owner_id") is None,
                    f"owner_id={channel.get('owner_id')}")
            log_test("Staff-sourced - source is staff_sourced", 
                    channel.get("source") == "staff_sourced",
                    f"source={channel.get('source')}")
            log_test("Staff-sourced - sourced_by_user_id set",
                    channel.get("sourced_by_user_id") == agent_id,
                    f"sourced_by={channel.get('sourced_by_user_id')}")
            log_test("Staff-sourced - status is pending_review",
                    channel.get("status") == "pending_review",
                    f"status={channel.get('status')}")
        else:
            log_test("Staff-sourced - Verify channel", False, f"Got {resp2.status_code}")
    else:
        log_test("Staff-sourced - Submit", False, f"Got {resp.status_code}")
    
    # Owner submission
    owner_channel = {
        "whatsapp_url": f"https://whatsapp.com/channel/0029VaP0bOwner{timestamp}",
        "name": f"Owner Self {timestamp}",
        "short_description": "Test channel by owner - owner_id should be set",
        "category_slug": "business",
        "country_code": "ID",
        "primary_language": "id"
    }
    
    resp = requests.post(f"{BASE_URL}/submit",
                        headers={"Cookie": f"wl_session={cookies['owner']}"},
                        json=owner_channel, timeout=10)
    
    if resp.status_code == 200:
        response_data = resp.json()
        owner_channel_id = response_data.get("data", {}).get("channel", {}).get("id")
        
        resp2 = requests.get(f"{BASE_URL}/admin/channels/{owner_channel_id}",
                            headers={"Cookie": f"wl_session={cookies['admin']}"}, timeout=10)
        
        if resp2.status_code == 200:
            response_data2 = resp2.json()
            channel = response_data2.get("data", {}).get("channel", response_data2.get("channel", {}))
            
            log_test("Owner self - owner_id is set", channel.get("owner_id") == owner_id,
                    f"owner_id={channel.get('owner_id')}")
            log_test("Owner self - source is owner_self",
                    channel.get("source") == "owner_self",
                    f"source={channel.get('source')}")
        else:
            log_test("Owner self - Verify channel", False, f"Got {resp2.status_code}")
    else:
        log_test("Owner self - Submit", False, f"Got {resp.status_code}")
    
    # TEST 6: Malicious body injection
    print("\n=== TEST 6: MALICIOUS BODY INJECTION ===")
    
    malicious = {
        "whatsapp_url": f"https://whatsapp.com/channel/0029VaP0bMal{timestamp}",
        "name": f"Malicious {timestamp}",
        "short_description": "Testing injection - should be ignored",
        "category_slug": "business",
        "country_code": "ID",
        "primary_language": "id",
        # Malicious fields
        "source": "owner_self",
        "sourced_by_user_id": owner_id,
        "owner_id": owner_id,
        "status": "approved",
        "verification_status": "verified"
    }
    
    resp = requests.post(f"{BASE_URL}/submit",
                        headers={"Cookie": f"wl_session={cookies['agent']}"},
                        json=malicious, timeout=10)
    
    if resp.status_code == 200:
        response_data = resp.json()
        mal_id = response_data.get("data", {}).get("channel", {}).get("id")
        
        resp2 = requests.get(f"{BASE_URL}/admin/channels/{mal_id}",
                            headers={"Cookie": f"wl_session={cookies['admin']}"}, timeout=10)
        
        if resp2.status_code == 200:
            response_data2 = resp2.json()
            channel = response_data2.get("data", {}).get("channel", response_data2.get("channel", {}))
            
            log_test("Injection - owner_id ignored", channel.get("owner_id") is None,
                    f"owner_id={channel.get('owner_id')}")
            log_test("Injection - source not overridden",
                    channel.get("source") == "staff_sourced",
                    f"source={channel.get('source')}")
            log_test("Injection - status not overridden",
                    channel.get("status") == "pending_review",
                    f"status={channel.get('status')}")
        else:
            log_test("Injection - Verify", False, f"Got {resp2.status_code}")
    else:
        log_test("Injection - Submit", False, f"Got {resp.status_code}")
    
    # Print summary
    print("\n" + "="*70)
    print("TEST SUMMARY")
    print("="*70)
    
    passed = sum(1 for t in test_results if t["passed"])
    failed = sum(1 for t in test_results if not t["passed"])
    total = len(test_results)
    
    print(f"\nTotal: {total} tests")
    print(f"✅ Passed: {passed}")
    print(f"❌ Failed: {failed}")
    
    if failed > 0:
        print("\nFailed tests:")
        for t in test_results:
            if not t["passed"]:
                print(f"  ❌ {t['name']}")
                if t["details"]:
                    print(f"     {t['details']}")

if __name__ == "__main__":
    main()
