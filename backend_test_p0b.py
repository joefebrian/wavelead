#!/usr/bin/env python3
"""
P0B Backend API Testing — Staff-Sourced Ownership & Claim Recovery
Tests the separation of SOURCING from OWNERSHIP to allow directory scaling.
"""

import requests
import json
import time
from typing import Dict, Any, Optional

# Test configuration
BASE_URL = "http://localhost:3000/api"
QA_PASSWORD = "P0bWave!2026Qa"

# QA accounts
QA_ADMIN = {"email": "qa-p0b-admin@wavelead.dev", "password": QA_PASSWORD}
QA_AGENT = {"email": "qa-p0b-agent@wavelead.dev", "password": QA_PASSWORD}
QA_OWNER = {"email": "qa-p0b-owner@wavelead.dev", "password": QA_PASSWORD}

# Test state
test_results = []
test_channels = []  # Track channels created during tests for cleanup


def log_test(name: str, passed: bool, details: str = ""):
    """Log test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    result = f"{status}: {name}"
    if details:
        result += f"\n    {details}"
    print(result)
    test_results.append({"name": name, "passed": passed, "details": details})


def login(email: str, password: str) -> Optional[str]:
    """Login and return session cookie"""
    try:
        resp = requests.post(
            f"{BASE_URL}/auth/login",
            json={"email": email, "password": password},
            timeout=10
        )
        if resp.status_code == 200:
            cookie = resp.cookies.get("wl_session")
            return cookie
        else:
            print(f"Login failed for {email}: {resp.status_code} {resp.text[:200]}")
            return None
    except Exception as e:
        print(f"Login error for {email}: {e}")
        return None


def make_request(
    method: str,
    path: str,
    cookie: Optional[str] = None,
    json_data: Optional[Dict] = None,
    params: Optional[Dict] = None
) -> requests.Response:
    """Make HTTP request with optional authentication"""
    url = f"{BASE_URL}{path}"
    headers = {}
    if cookie:
        headers["Cookie"] = f"wl_session={cookie}"
    
    try:
        if method == "GET":
            return requests.get(url, headers=headers, params=params, timeout=10)
        elif method == "POST":
            return requests.post(url, headers=headers, json=json_data, timeout=10)
        elif method == "PUT":
            return requests.put(url, headers=headers, json=json_data, timeout=10)
        elif method == "DELETE":
            return requests.delete(url, headers=headers, timeout=10)
        else:
            raise ValueError(f"Unsupported method: {method}")
    except Exception as e:
        print(f"Request error: {e}")
        raise


def test_authorization():
    """Test 1: Authorization on all P0B endpoints"""
    print("\n=== TEST 1: AUTHORIZATION ===")
    
    # Login as different users
    admin_cookie = login(QA_ADMIN["email"], QA_ADMIN["password"])
    agent_cookie = login(QA_AGENT["email"], QA_AGENT["password"])
    owner_cookie = login(QA_OWNER["email"], QA_OWNER["password"])
    
    if not all([admin_cookie, agent_cookie, owner_cookie]):
        log_test("Authorization - QA user login", False, "Failed to login QA users")
        return
    
    log_test("Authorization - QA user login", True, "All QA users logged in successfully")
    
    # Test endpoints with different authorization levels
    endpoints = [
        # (path, method, admin_only, moderator_allowed, description)
        ("/admin/diagnostics/build", "GET", True, False, "Build diagnostics"),
        ("/admin/operations/metrics", "GET", False, True, "Metrics"),
        ("/admin/operations/sourcing-agents", "GET", True, False, "List sourcing agents"),
        ("/admin/operations/sourcing-agents", "POST", True, False, "Designate sourcing agent"),
        ("/admin/operations/sourcing-daily", "GET", False, True, "Sourcing daily stats"),
        ("/admin/operations/release-candidates", "GET", True, False, "Release candidates"),
        ("/admin/operations/snapshots", "GET", False, True, "List snapshots"),
        ("/admin/operations/snapshots", "POST", True, False, "Capture snapshot"),
        ("/admin/operations/snapshots/diff", "GET", False, True, "Snapshot diff"),
    ]
    
    for path, method, admin_only, moderator_allowed, desc in endpoints:
        # Test anonymous access (should be 401)
        resp = make_request(method, path)
        if resp.status_code in [401, 403]:
            log_test(f"Authorization - {desc} - Anonymous denied", True, f"Got {resp.status_code}")
        else:
            log_test(f"Authorization - {desc} - Anonymous denied", False, 
                    f"Expected 401/403, got {resp.status_code}")
        
        # Test ordinary user access (should be 403)
        json_data = {"user_id": "test", "enabled": True, "reason": "test"} if method == "POST" and "sourcing-agents" in path else None
        json_data = {"phase": "pre_deploy"} if method == "POST" and "snapshots" in path else json_data
        
        resp = make_request(method, path, cookie=owner_cookie, json_data=json_data)
        if resp.status_code == 403:
            log_test(f"Authorization - {desc} - Ordinary user denied", True, "Got 403")
        else:
            log_test(f"Authorization - {desc} - Ordinary user denied", False, 
                    f"Expected 403, got {resp.status_code}")
        
        # Test admin access (should succeed)
        resp = make_request(method, path, cookie=admin_cookie, json_data=json_data)
        if resp.status_code in [200, 400]:  # 400 is OK for POST with invalid data
            log_test(f"Authorization - {desc} - Admin allowed", True, f"Got {resp.status_code}")
        else:
            log_test(f"Authorization - {desc} - Admin allowed", False, 
                    f"Expected 200/400, got {resp.status_code}: {resp.text[:200]}")


def create_test_channel(cookie: str, name_suffix: str = "") -> Optional[str]:
    """Helper: Create a test channel and return its ID"""
    timestamp = int(time.time())
    channel_data = {
        "whatsapp_url": f"https://whatsapp.com/channel/0029VaP0bTest{timestamp}",
        "name": f"P0B Test Channel {timestamp}{name_suffix}",
        "short_description": "Test channel for P0B backend testing - not a real channel",
        "category_slug": "business",
        "country_code": "ID",
        "primary_language": "id"
    }
    
    try:
        resp = make_request("POST", "/submit", cookie=cookie, json_data=channel_data)
        if resp.status_code == 200:
            data = resp.json()
            channel_id = data.get("channel", {}).get("id")
            if channel_id:
                test_channels.append(channel_id)
            return channel_id
        else:
            print(f"Failed to create test channel: {resp.status_code} {resp.text[:200]}")
            return None
    except Exception as e:
        print(f"Error creating test channel: {e}")
        return None


def test_sourcing_agent_designation():
    """Test 2: Sourcing agent designation"""
    print("\n=== TEST 2: SOURCING AGENT DESIGNATION ===")
    
    admin_cookie = login(QA_ADMIN["email"], QA_ADMIN["password"])
    owner_cookie = login(QA_OWNER["email"], QA_OWNER["password"])
    
    # Get owner user ID
    resp = make_request("GET", "/auth/me", cookie=owner_cookie)
    if resp.status_code != 200:
        log_test("Sourcing agent - Get user ID", False, "Failed to get user info")
        return
    
    owner_user_id = resp.json().get("user", {}).get("id")
    
    # Test designation without reason (should fail)
    resp = make_request("POST", "/admin/operations/sourcing-agents", cookie=admin_cookie,
                       json_data={"user_id": owner_user_id, "enabled": True, "reason": "abc"})
    log_test("Sourcing agent - Short reason rejected", 
            resp.status_code == 400, f"Got {resp.status_code}")
    
    # Designate as sourcing agent
    resp = make_request("POST", "/admin/operations/sourcing-agents", cookie=admin_cookie,
                       json_data={"user_id": owner_user_id, "enabled": True, 
                                 "reason": "Testing P0B sourcing agent designation"})
    log_test("Sourcing agent - Designation succeeds", 
            resp.status_code == 200 and resp.json().get("changed") == True,
            f"Got {resp.status_code}, changed={resp.json().get('changed')}")
    
    # Idempotent check - designate again
    resp = make_request("POST", "/admin/operations/sourcing-agents", cookie=admin_cookie,
                       json_data={"user_id": owner_user_id, "enabled": True, 
                                 "reason": "Testing idempotency"})
    log_test("Sourcing agent - Idempotent designation", 
            resp.status_code == 200 and resp.json().get("changed") == False,
            f"Got {resp.status_code}, changed={resp.json().get('changed')}")
    
    # Verify in list
    resp = make_request("GET", "/admin/operations/sourcing-agents", cookie=admin_cookie)
    if resp.status_code == 200:
        agents = resp.json().get("items", [])
        found = any(a.get("user_id") == owner_user_id for a in agents)
        log_test("Sourcing agent - Appears in list", found, 
                f"Found {len(agents)} agents, target in list: {found}")
    
    # Revoke designation
    resp = make_request("POST", "/admin/operations/sourcing-agents", cookie=admin_cookie,
                       json_data={"user_id": owner_user_id, "enabled": False, 
                                 "reason": "Testing revocation"})
    log_test("Sourcing agent - Revocation succeeds", 
            resp.status_code == 200 and resp.json().get("changed") == True,
            f"Got {resp.status_code}")


def test_staff_sourced_submission():
    """Test 3: Staff-sourced submission attribution"""
    print("\n=== TEST 3: STAFF-SOURCED SUBMISSION ===")
    
    agent_cookie = login(QA_AGENT["email"], QA_AGENT["password"])
    owner_cookie = login(QA_OWNER["email"], QA_OWNER["password"])
    admin_cookie = login(QA_ADMIN["email"], QA_ADMIN["password"])
    
    # Get agent user ID
    resp = make_request("GET", "/auth/me", cookie=agent_cookie)
    agent_user_id = resp.json().get("user", {}).get("id")
    
    # Get owner user ID
    resp = make_request("GET", "/auth/me", cookie=owner_cookie)
    owner_user_id = resp.json().get("user", {}).get("id")
    
    # Test 3a: Agent submission should have owner_id NULL
    timestamp = int(time.time())
    agent_channel_data = {
        "whatsapp_url": f"https://whatsapp.com/channel/0029VaP0bAgent{timestamp}",
        "name": f"Agent Sourced Channel {timestamp}",
        "short_description": "Channel sourced by agent - owner_id should be NULL",
        "category_slug": "business",
        "country_code": "ID",
        "primary_language": "id"
    }
    
    resp = make_request("POST", "/submit", cookie=agent_cookie, json_data=agent_channel_data)
    if resp.status_code == 200:
        agent_channel_id = resp.json().get("channel", {}).get("id")
        test_channels.append(agent_channel_id)
        
        # Verify in database via admin endpoint
        resp = make_request("GET", f"/admin/channels/{agent_channel_id}", cookie=admin_cookie)
        if resp.status_code == 200:
            response_data = resp.json()
            channel = response_data.get("channel", response_data)
            owner_id = channel.get("owner_id")
            source = channel.get("source")
            sourced_by = channel.get("sourced_by_user_id")
            sourced_at = channel.get("sourced_at")
            status = channel.get("status")
            verification_status = channel.get("verification_status")
            
            log_test("Staff-sourced - owner_id is NULL", 
                    owner_id is None, f"owner_id={owner_id}")
            log_test("Staff-sourced - source is staff_sourced", 
                    source == "staff_sourced", f"source={source}")
            log_test("Staff-sourced - sourced_by_user_id set", 
                    sourced_by == agent_user_id, f"sourced_by={sourced_by}")
            log_test("Staff-sourced - sourced_at set", 
                    sourced_at is not None, f"sourced_at={sourced_at}")
            log_test("Staff-sourced - status is pending_review", 
                    status == "pending_review", f"status={status}")
            log_test("Staff-sourced - verification_status is unclaimed", 
                    verification_status == "unclaimed", f"verification_status={verification_status}")
        else:
            log_test("Staff-sourced - Verify channel data", False, 
                    f"Failed to get channel: {resp.status_code}")
    else:
        log_test("Staff-sourced - Agent submission", False, 
                f"Failed: {resp.status_code} {resp.text[:200]}")
    
    # Test 3b: Owner submission should have owner_id set
    owner_channel_data = {
        "whatsapp_url": f"https://whatsapp.com/channel/0029VaP0bOwner{timestamp}",
        "name": f"Owner Self Channel {timestamp}",
        "short_description": "Channel submitted by owner - owner_id should be set",
        "category_slug": "business",
        "country_code": "ID",
        "primary_language": "id"
    }
    
    resp = make_request("POST", "/submit", cookie=owner_cookie, json_data=owner_channel_data)
    if resp.status_code == 200:
        owner_channel_id = resp.json().get("channel", {}).get("id")
        test_channels.append(owner_channel_id)
        
        resp = make_request("GET", f"/admin/channels/{owner_channel_id}", cookie=admin_cookie)
        if resp.status_code == 200:
            response_data = resp.json()
            channel = response_data.get("channel", response_data)
            owner_id = channel.get("owner_id")
            source = channel.get("source")
            sourced_by = channel.get("sourced_by_user_id")
            
            log_test("Owner self - owner_id is set", 
                    owner_id == owner_user_id, f"owner_id={owner_id}")
            log_test("Owner self - source is owner_self", 
                    source == "owner_self", f"source={source}")
            log_test("Owner self - sourced_by_user_id is NULL", 
                    sourced_by is None, f"sourced_by={sourced_by}")
        else:
            log_test("Owner self - Verify channel data", False, 
                    f"Failed to get channel: {resp.status_code}")
    else:
        log_test("Owner self - Owner submission", False, 
                f"Failed: {resp.status_code} {resp.text[:200]}")
    
    # Test 3c: Malicious body field injection
    malicious_data = {
        "whatsapp_url": f"https://whatsapp.com/channel/0029VaP0bMalicious{timestamp}",
        "name": f"Malicious Injection Test {timestamp}",
        "short_description": "Testing body field injection - should be ignored",
        "category_slug": "business",
        "country_code": "ID",
        "primary_language": "id",
        # Malicious fields that should be ignored
        "source": "owner_self",
        "sourced_by_user_id": owner_user_id,
        "owner_id": owner_user_id,
        "status": "approved",
        "verification_status": "verified",
        "is_test_fixture": False
    }
    
    resp = make_request("POST", "/submit", cookie=agent_cookie, json_data=malicious_data)
    if resp.status_code == 200:
        mal_channel_id = resp.json().get("channel", {}).get("id")
        test_channels.append(mal_channel_id)
        
        resp = make_request("GET", f"/admin/channels/{mal_channel_id}", cookie=admin_cookie)
        if resp.status_code == 200:
            response_data = resp.json()
            channel = response_data.get("channel", response_data)
            # All injected fields should be ignored
            log_test("Malicious injection - owner_id ignored", 
                    channel.get("owner_id") is None, 
                    f"owner_id={channel.get('owner_id')}")
            log_test("Malicious injection - source not overridden", 
                    channel.get("source") == "staff_sourced", 
                    f"source={channel.get('source')}")
            log_test("Malicious injection - status not overridden", 
                    channel.get("status") == "pending_review", 
                    f"status={channel.get('status')}")
            log_test("Malicious injection - verification_status not overridden", 
                    channel.get("verification_status") == "unclaimed", 
                    f"verification_status={channel.get('verification_status')}")
        else:
            log_test("Malicious injection - Verify ignored", False, 
                    f"Failed to get channel: {resp.status_code}")
    else:
        log_test("Malicious injection - Submission", False, 
                f"Failed: {resp.status_code} {resp.text[:200]}")


def test_fast_verification_safeguard():
    """Test 4: Fast Verification safeguard - sourcing is not ownership"""
    print("\n=== TEST 4: FAST VERIFICATION SAFEGUARD ===")
    
    agent_cookie = login(QA_AGENT["email"], QA_AGENT["password"])
    owner_cookie = login(QA_OWNER["email"], QA_OWNER["password"])
    admin_cookie = login(QA_ADMIN["email"], QA_ADMIN["password"])
    
    # Create a channel as agent (staff_sourced)
    agent_channel_id = create_test_channel(agent_cookie, " - Fast Verification Test")
    if not agent_channel_id:
        log_test("Fast verification - Create test channel", False, "Failed to create channel")
        return
    
    # Approve the channel so it can be claimed
    resp = make_request("POST", f"/admin/channels/{agent_channel_id}/approve", 
                       cookie=admin_cookie, json_data={})
    if resp.status_code != 200:
        log_test("Fast verification - Approve channel", False, 
                f"Failed to approve: {resp.status_code}")
        return
    
    log_test("Fast verification - Channel approved", True, "Channel ready for testing")
    
    # Agent tries to start fast verification (should be refused)
    resp = make_request("POST", f"/owner/channels/{agent_channel_id}/verification/start-fast", 
                       cookie=agent_cookie, json_data={})
    
    if resp.status_code == 403:
        error_msg = resp.json().get("error", "")
        contains_sourcing_msg = "sourcing" in error_msg.lower() or "ownership" in error_msg.lower()
        log_test("Fast verification - Agent refused", True, 
                f"Got 403 with message: {error_msg[:100]}")
        log_test("Fast verification - Error message mentions sourcing", contains_sourcing_msg,
                f"Message: {error_msg[:100]}")
    else:
        log_test("Fast verification - Agent refused", False, 
                f"Expected 403, got {resp.status_code}: {resp.text[:200]}")
    
    # Create a channel as owner (owner_self)
    owner_channel_id = create_test_channel(owner_cookie, " - Owner Fast Verification")
    if not owner_channel_id:
        log_test("Fast verification - Create owner channel", False, "Failed to create channel")
        return
    
    # Approve the owner's channel
    resp = make_request("POST", f"/admin/channels/{owner_channel_id}/approve", 
                       cookie=admin_cookie, json_data={})
    if resp.status_code != 200:
        log_test("Fast verification - Approve owner channel", False, 
                f"Failed to approve: {resp.status_code}")
        return
    
    # Owner tries to start fast verification (should be allowed to start, PayPal error is OK)
    resp = make_request("POST", f"/owner/channels/{owner_channel_id}/verification/start-fast", 
                       cookie=owner_cookie, json_data={})
    
    # We expect either 200 (started) or a PayPal-related error, but NOT 403 eligibility denial
    if resp.status_code in [200, 400, 500, 503]:
        # Check if it's NOT an eligibility error
        error_msg = resp.json().get("error", "") if resp.status_code != 200 else ""
        is_eligibility_error = "not eligible" in error_msg.lower() or "sourcing" in error_msg.lower()
        
        if not is_eligibility_error:
            log_test("Fast verification - Owner allowed to start", True, 
                    f"Got {resp.status_code} (PayPal errors are acceptable)")
        else:
            log_test("Fast verification - Owner allowed to start", False, 
                    f"Got eligibility error: {error_msg[:100]}")
    elif resp.status_code == 403:
        log_test("Fast verification - Owner allowed to start", False, 
                f"Owner was denied with 403: {resp.text[:200]}")
    else:
        log_test("Fast verification - Owner allowed to start", False, 
                f"Unexpected status {resp.status_code}: {resp.text[:200]}")


def test_metrics():
    """Test 5: Claim-path metrics"""
    print("\n=== TEST 5: CLAIM-PATH METRICS ===")
    
    admin_cookie = login(QA_ADMIN["email"], QA_ADMIN["password"])
    
    resp = make_request("GET", "/admin/operations/metrics", cookie=admin_cookie)
    if resp.status_code != 200:
        log_test("Metrics - Fetch metrics", False, f"Failed: {resp.status_code}")
        return
    
    metrics = resp.json()
    
    # Check required fields
    required_fields = [
        "public_approved_total", "claimable", "linked_unverified", 
        "verified_ownership", "needs_review", "sum_matches_total",
        "pending_claims", "activation_active"
    ]
    
    all_present = all(field in metrics for field in required_fields)
    log_test("Metrics - All required fields present", all_present,
            f"Fields: {list(metrics.keys())}")
    
    # Check sum_matches_total
    if all_present:
        total = metrics["public_approved_total"]
        sum_buckets = (metrics["claimable"] + metrics["linked_unverified"] + 
                      metrics["verified_ownership"] + metrics["needs_review"])
        matches = sum_buckets == total
        
        log_test("Metrics - sum_matches_total is true", 
                metrics["sum_matches_total"] == True,
                f"sum_matches_total={metrics['sum_matches_total']}")
        
        log_test("Metrics - Buckets sum to total", matches,
                f"Total={total}, Sum={sum_buckets}")
        
        # All counts should be non-negative
        all_non_negative = all(metrics[f] >= 0 for f in required_fields if f != "sum_matches_total")
        log_test("Metrics - All counts non-negative", all_non_negative,
                f"Counts: {[(f, metrics[f]) for f in required_fields if f != 'sum_matches_total']}")


def test_snapshots():
    """Test 6: Inventory snapshots"""
    print("\n=== TEST 6: INVENTORY SNAPSHOTS ===")
    
    admin_cookie = login(QA_ADMIN["email"], QA_ADMIN["password"])
    
    # Capture a snapshot
    release_key = f"test-p0b-{int(time.time())}"
    resp = make_request("POST", "/admin/operations/snapshots", cookie=admin_cookie,
                       json_data={"phase": "pre_deploy", "release_key": release_key, 
                                 "note": "P0B testing snapshot"})
    
    if resp.status_code != 200:
        log_test("Snapshots - Capture snapshot", False, 
                f"Failed: {resp.status_code} {resp.text[:200]}")
        return
    
    data = resp.json()
    log_test("Snapshots - Capture succeeds", 
            data.get("created") == True, f"created={data.get('created')}")
    
    snapshot = data.get("snapshot", {})
    
    # Verify snapshot structure
    has_metrics = "metrics" in snapshot
    has_aggregate_only = has_metrics and isinstance(snapshot["metrics"], dict)
    
    log_test("Snapshots - Contains metrics", has_metrics, 
            f"Keys: {list(snapshot.keys())}")
    
    if has_aggregate_only:
        # Check that it's aggregate counts only (no channel list, no PII)
        metrics = snapshot["metrics"]
        has_counts = "public_approved_total" in metrics
        no_channels = "channels" not in snapshot and "items" not in snapshot
        no_urls = "whatsapp_url" not in str(snapshot)
        no_emails = "@" not in str(snapshot) or "captured_by" in str(snapshot)  # captured_by email is OK
        
        log_test("Snapshots - Aggregate counts only", has_counts and no_channels,
                f"Has counts: {has_counts}, No channel list: {no_channels}")
        log_test("Snapshots - No WhatsApp URLs", no_urls, "No URLs in snapshot")
    
    # Capture again (idempotency test)
    resp = make_request("POST", "/admin/operations/snapshots", cookie=admin_cookie,
                       json_data={"phase": "pre_deploy", "release_key": release_key, 
                                 "note": "Duplicate capture"})
    
    if resp.status_code == 200:
        data = resp.json()
        log_test("Snapshots - Idempotent capture", 
                data.get("created") == False, 
                f"Second capture created={data.get('created')}")
    
    # Test diff with missing baseline
    resp = make_request("GET", "/admin/operations/snapshots/diff", cookie=admin_cookie,
                       params={"release_key": release_key})
    
    if resp.status_code == 200:
        diff = resp.json()
        has_pre = diff.get("pre") is not None
        has_post = diff.get("post") is None  # We only captured pre_deploy
        deltas_null = diff.get("deltas") is None
        has_note = "note" in diff and "baseline" in diff["note"].lower()
        
        log_test("Snapshots - Diff with missing post", 
                has_pre and has_post and deltas_null,
                f"pre={has_pre}, post={has_post}, deltas={deltas_null}")
        log_test("Snapshots - Diff note explains missing baseline", has_note,
                f"Note: {diff.get('note', '')[:100]}")
    
    # Capture post_deploy
    resp = make_request("POST", "/admin/operations/snapshots", cookie=admin_cookie,
                       json_data={"phase": "post_deploy", "release_key": release_key, 
                                 "note": "Post-deploy snapshot"})
    
    if resp.status_code == 200:
        # Now diff should have both phases
        resp = make_request("GET", "/admin/operations/snapshots/diff", cookie=admin_cookie,
                           params={"release_key": release_key})
        
        if resp.status_code == 200:
            diff = resp.json()
            has_both = diff.get("pre") is not None and diff.get("post") is not None
            has_deltas = diff.get("deltas") is not None
            
            log_test("Snapshots - Diff with both phases", has_both and has_deltas,
                    f"Has pre: {diff.get('pre') is not None}, Has post: {diff.get('post') is not None}, Has deltas: {has_deltas}")
            
            if has_deltas:
                deltas = diff["deltas"]
                all_numeric = all(isinstance(v, (int, float)) for v in deltas.values())
                log_test("Snapshots - Deltas are numeric", all_numeric,
                        f"Deltas: {deltas}")


def test_public_health():
    """Test 7: Public health endpoint should not leak build info"""
    print("\n=== TEST 7: PUBLIC HEALTH ENDPOINT ===")
    
    resp = make_request("GET", "/health")
    if resp.status_code != 200:
        log_test("Public health - Endpoint accessible", False, 
                f"Failed: {resp.status_code}")
        return
    
    response_data = resp.json()
    # The response is wrapped in {ok: true, data: {...}}
    data = response_data.get("data", response_data)
    
    # Should have only: status, service, time, env
    allowed_fields = {"status", "service", "time", "env"}
    actual_fields = set(data.keys())
    
    has_only_allowed = actual_fields.issubset(allowed_fields)
    log_test("Public health - Only safe fields", has_only_allowed,
            f"Fields: {actual_fields}")
    
    # Should NOT have: version, commit, commitTime, branch
    forbidden_fields = {"version", "commit", "commitTime", "branch", "build_time", "release_id"}
    has_forbidden = bool(actual_fields & forbidden_fields)
    
    log_test("Public health - No build info leaked", not has_forbidden,
            f"Forbidden fields present: {actual_fields & forbidden_fields}")
    
    # Should have required fields
    has_required = all(f in data for f in ["status", "service"])
    log_test("Public health - Has required fields", has_required,
            f"status={data.get('status')}, service={data.get('service')}")


def print_summary():
    """Print test summary"""
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
    
    print("\n" + "="*70)


def main():
    """Run all P0B backend tests"""
    print("="*70)
    print("P0B BACKEND API TESTING")
    print("Testing against: " + BASE_URL)
    print("="*70)
    
    try:
        test_authorization()
        test_sourcing_agent_designation()
        test_staff_sourced_submission()
        test_fast_verification_safeguard()
        test_metrics()
        test_snapshots()
        test_public_health()
        
    except KeyboardInterrupt:
        print("\n\nTests interrupted by user")
    except Exception as e:
        print(f"\n\nFATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        print_summary()
        
        if test_channels:
            print(f"\n📝 Created {len(test_channels)} test channels during testing")
            print("    These are marked as test fixtures and can be cleaned up if needed")


if __name__ == "__main__":
    main()
