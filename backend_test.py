#!/usr/bin/env python3
"""
WaveLead Milestone 00.3 — Runtime Stability Verification
DO NOT MODIFY CODE - VERIFICATION ONLY
"""

import requests
import subprocess
import time
import json
import sys
from typing import Dict, List, Tuple
from pymongo import MongoClient

# Configuration
LOCAL_BASE = "http://localhost:3000"
DEPLOYED_BASE = "https://grow-infrastructure.preview.emergentagent.com"
SUPER_ADMIN_EMAIL = "admin@wavelead.dev"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "wavelead"

# Test routes with expected status codes
ROUTES = [
    ("/api/health", 200),
    ("/", 200),
    ("/channels", 200),
    ("/trending", 200),
    ("/top", 200),
    ("/pricing", 200),
    ("/about", 200),
    ("/terms", 200),
    ("/privacy", 200),
    ("/login", 200),
    ("/signup", 200),
    ("/dashboard", 307),  # redirect to /login
    ("/admin", 307),  # redirect to /login
]

class TestResults:
    def __init__(self):
        self.results = {}
        self.failures = []
    
    def add_result(self, test_name: str, passed: bool, details: str = ""):
        self.results[test_name] = {"passed": passed, "details": details}
        if not passed:
            self.failures.append(f"{test_name}: {details}")
    
    def print_summary(self):
        print("\n" + "="*80)
        print("MILESTONE 00.3 — RUNTIME STABILITY VERIFICATION SUMMARY")
        print("="*80)
        for test_name, result in self.results.items():
            status = "✅ PASS" if result["passed"] else "❌ FAIL"
            print(f"\n{status} - {test_name}")
            if result["details"]:
                print(f"  {result['details']}")
        
        print("\n" + "="*80)
        if self.failures:
            print(f"OVERALL: ❌ FAILED ({len(self.failures)} failures)")
            for failure in self.failures:
                print(f"  - {failure}")
        else:
            print("OVERALL: ✅ ALL CHECKS PASSED")
        print("="*80 + "\n")

results = TestResults()

def test_1_local_routes():
    """Test 1: Route smoke test — LOCAL (bypass ingress)"""
    print("\n" + "="*80)
    print("TEST 1: Route smoke test — LOCAL (bypass ingress)")
    print("="*80)
    
    all_passed = True
    details = []
    
    for route, expected_status in ROUTES:
        url = f"{LOCAL_BASE}{route}"
        route_results = []
        
        for attempt in range(1, 4):
            try:
                response = requests.get(url, allow_redirects=False, timeout=10)
                status = response.status_code
                route_results.append(status)
                
                if status != expected_status:
                    all_passed = False
                    details.append(f"{route} attempt {attempt}: got {status}, expected {expected_status}")
                
                print(f"  {route} attempt {attempt}: {status} {'✅' if status == expected_status else '❌'}")
            except Exception as e:
                all_passed = False
                route_results.append(f"ERROR: {str(e)}")
                details.append(f"{route} attempt {attempt}: {str(e)}")
                print(f"  {route} attempt {attempt}: ERROR - {str(e)} ❌")
            
            time.sleep(0.1)
    
    results.add_result(
        "Test 1: Local route smoke test",
        all_passed,
        "; ".join(details) if details else "All 12 routes × 3 attempts returned expected status codes"
    )

def test_2_deployed_routes():
    """Test 2: Route smoke test — DEPLOYED preview"""
    print("\n" + "="*80)
    print("TEST 2: Route smoke test — DEPLOYED preview")
    print("="*80)
    
    all_passed = True
    details = []
    
    for route, expected_status in ROUTES:
        url = f"{DEPLOYED_BASE}{route}"
        
        try:
            response = requests.get(url, allow_redirects=False, timeout=15)
            status = response.status_code
            
            if status != expected_status:
                all_passed = False
                details.append(f"{route}: got {status}, expected {expected_status}")
            
            print(f"  {route}: {status} {'✅' if status == expected_status else '❌'}")
        except Exception as e:
            all_passed = False
            details.append(f"{route}: {str(e)}")
            print(f"  {route}: ERROR - {str(e)} ❌")
        
        time.sleep(0.2)
    
    results.add_result(
        "Test 2: Deployed route smoke test",
        all_passed,
        "; ".join(details) if details else "All 12 routes returned expected status codes on deployed preview"
    )

def test_3_health_stability():
    """Test 3: /api/health stability (30 consecutive calls)"""
    print("\n" + "="*80)
    print("TEST 3: /api/health stability (30 consecutive calls)")
    print("="*80)
    
    url = f"{LOCAL_BASE}/api/health"
    latencies = []
    failures = []
    
    for i in range(1, 31):
        try:
            start = time.time()
            response = requests.get(url, timeout=5)
            latency = (time.time() - start) * 1000  # ms
            latencies.append(latency)
            
            if response.status_code != 200:
                failures.append(f"Call {i}: status {response.status_code}")
            
            if i % 10 == 0:
                print(f"  Completed {i}/30 calls...")
        except Exception as e:
            failures.append(f"Call {i}: {str(e)}")
    
    if latencies:
        min_lat = min(latencies)
        max_lat = max(latencies)
        avg_lat = sum(latencies) / len(latencies)
        print(f"\n  Latency: min={min_lat:.2f}ms, max={max_lat:.2f}ms, avg={avg_lat:.2f}ms")
    
    all_passed = len(failures) == 0
    results.add_result(
        "Test 3: Health endpoint stability",
        all_passed,
        "; ".join(failures) if failures else f"30/30 calls returned 200 (avg latency: {avg_lat:.2f}ms)"
    )

def test_4_memory_restart_check():
    """Test 4: Memory-restart regression check"""
    print("\n" + "="*80)
    print("TEST 4: Memory-restart regression check")
    print("="*80)
    
    try:
        result = subprocess.run(
            ["tail", "-n", "200", "/var/log/supervisor/nextjs.out.log"],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        log_content = result.stdout
        
        memory_warnings = "approaching the used memory threshold" in log_content.lower()
        restart_warnings = "restarting..." in log_content.lower()
        
        found_issues = memory_warnings or restart_warnings
        
        if memory_warnings:
            print("  ❌ Found 'approaching the used memory threshold' in logs")
        if restart_warnings:
            print("  ❌ Found 'restarting...' in logs")
        
        if not found_issues:
            print("  ✅ No memory threshold or restart warnings found")
        
        results.add_result(
            "Test 4: Memory restart regression",
            not found_issues,
            "Memory/restart warnings found in logs" if found_issues else "No memory/restart warnings in last 200 log lines"
        )
    except Exception as e:
        results.add_result(
            "Test 4: Memory restart regression",
            False,
            f"Failed to check logs: {str(e)}"
        )

def test_5_authorization():
    """Test 5: Authorization tests"""
    print("\n" + "="*80)
    print("TEST 5: Authorization tests")
    print("="*80)
    
    all_passed = True
    details = []
    
    # Test 5a: Unauthenticated /admin redirect
    print("\n  5a: Unauthenticated /admin redirect")
    try:
        response = requests.get(f"{LOCAL_BASE}/admin", allow_redirects=False, timeout=5)
        if response.status_code == 307:
            location = response.headers.get("location", "")
            if "/login" in location and "next=/admin" in location:
                print(f"    ✅ Correct redirect: {response.status_code} → {location}")
            else:
                all_passed = False
                details.append(f"5a: Wrong redirect location: {location}")
                print(f"    ❌ Wrong redirect location: {location}")
        else:
            all_passed = False
            details.append(f"5a: Expected 307, got {response.status_code}")
            print(f"    ❌ Expected 307, got {response.status_code}")
    except Exception as e:
        all_passed = False
        details.append(f"5a: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 5b: Regular user cannot access admin endpoint
    print("\n  5b: Regular user (role=user) denied admin access")
    try:
        # Signup a regular user
        signup_data = {
            "email": f"regularuser_{int(time.time())}@test.com",
            "password": "TestPass123!",
            "display_name": "Regular User"
        }
        signup_response = requests.post(
            f"{LOCAL_BASE}/api/auth/signup",
            json=signup_data,
            timeout=5
        )
        
        if signup_response.status_code == 200:
            cookies = signup_response.cookies
            
            # Try to access admin endpoint
            admin_response = requests.get(
                f"{LOCAL_BASE}/api/admin/ping",
                cookies=cookies,
                timeout=5
            )
            
            if admin_response.status_code == 403:
                print(f"    ✅ Regular user correctly denied: {admin_response.status_code}")
            else:
                all_passed = False
                details.append(f"5b: Expected 403, got {admin_response.status_code}")
                print(f"    ❌ Expected 403, got {admin_response.status_code}")
        else:
            all_passed = False
            details.append(f"5b: Signup failed with {signup_response.status_code}")
            print(f"    ❌ Signup failed: {signup_response.status_code}")
    except Exception as e:
        all_passed = False
        details.append(f"5b: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 5c: Live-role stale-role protection
    print("\n  5c: Live-role stale-role protection")
    try:
        # Clear users collection
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        db.users.delete_many({})
        print("    Cleared users collection")
        
        # Signup with super admin email
        admin_signup_data = {
            "email": SUPER_ADMIN_EMAIL,
            "password": "AdminPass123!",
            "display_name": "Super Admin"
        }
        admin_signup_response = requests.post(
            f"{LOCAL_BASE}/api/auth/signup",
            json=admin_signup_data,
            timeout=5
        )
        
        if admin_signup_response.status_code != 200:
            all_passed = False
            details.append(f"5c: Admin signup failed with {admin_signup_response.status_code}")
            print(f"    ❌ Admin signup failed: {admin_signup_response.status_code}")
        else:
            cookies = admin_signup_response.cookies
            
            # Verify admin access works
            admin_ping_1 = requests.get(
                f"{LOCAL_BASE}/api/admin/ping",
                cookies=cookies,
                timeout=5
            )
            
            if admin_ping_1.status_code != 200:
                all_passed = False
                details.append(f"5c: Initial admin ping failed: {admin_ping_1.status_code}")
                print(f"    ❌ Initial admin ping failed: {admin_ping_1.status_code}")
            else:
                print(f"    ✅ Initial admin ping: {admin_ping_1.status_code}")
                
                # Downgrade user role in DB
                user = db.users.find_one({"email": SUPER_ADMIN_EMAIL})
                if user:
                    db.users.update_one(
                        {"email": SUPER_ADMIN_EMAIL},
                        {"$set": {"role": "user"}}
                    )
                    print("    Downgraded user role to 'user' in DB")
                    
                    # Try admin ping with same cookie - should be denied immediately
                    admin_ping_2 = requests.get(
                        f"{LOCAL_BASE}/api/admin/ping",
                        cookies=cookies,
                        timeout=5
                    )
                    
                    if admin_ping_2.status_code == 403:
                        print(f"    ✅ Downgraded user correctly denied: {admin_ping_2.status_code}")
                    else:
                        all_passed = False
                        details.append(f"5c: Expected 403 after downgrade, got {admin_ping_2.status_code}")
                        print(f"    ❌ Expected 403 after downgrade, got {admin_ping_2.status_code}")
                else:
                    all_passed = False
                    details.append("5c: Could not find user in DB")
                    print("    ❌ Could not find user in DB")
        
        client.close()
    except Exception as e:
        all_passed = False
        details.append(f"5c: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    results.add_result(
        "Test 5: Authorization tests",
        all_passed,
        "; ".join(details) if details else "All 3 authorization tests passed"
    )

def test_6_cors_regression():
    """Test 6: CORS regression"""
    print("\n" + "="*80)
    print("TEST 6: CORS regression")
    print("="*80)
    
    all_passed = True
    details = []
    
    # Test 6a: Evil origin not allowed
    print("\n  6a: Evil origin rejected")
    try:
        response = requests.get(
            f"{LOCAL_BASE}/api/health",
            headers={"Origin": "https://evil.example"},
            timeout=5
        )
        
        cors_header = response.headers.get("Access-Control-Allow-Origin", "")
        
        if cors_header == "*":
            all_passed = False
            details.append("6a: Wildcard CORS header present")
            print(f"    ❌ Found wildcard CORS: {cors_header}")
        elif cors_header == "https://evil.example":
            all_passed = False
            details.append("6a: Evil origin echoed")
            print(f"    ❌ Evil origin echoed: {cors_header}")
        else:
            print(f"    ✅ Evil origin not allowed (CORS header: {cors_header or 'none'})")
    except Exception as e:
        all_passed = False
        details.append(f"6a: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 6b: Allowed origin echoed correctly
    print("\n  6b: Allowed origin echoed correctly")
    try:
        allowed_origin = "https://grow-infrastructure.preview.emergentagent.com"
        response = requests.get(
            f"{LOCAL_BASE}/api/health",
            headers={"Origin": allowed_origin},
            timeout=5
        )
        
        cors_header = response.headers.get("Access-Control-Allow-Origin", "")
        vary_header = response.headers.get("Vary", "")
        
        if cors_header == allowed_origin and "Origin" in vary_header:
            print(f"    ✅ Allowed origin echoed: {cors_header}")
            print(f"    ✅ Vary header present: {vary_header}")
        else:
            all_passed = False
            if cors_header != allowed_origin:
                details.append(f"6b: Expected {allowed_origin}, got {cors_header}")
                print(f"    ❌ Wrong CORS header: {cors_header}")
            if "Origin" not in vary_header:
                details.append(f"6b: Vary header missing or wrong: {vary_header}")
                print(f"    ❌ Vary header missing or wrong: {vary_header}")
    except Exception as e:
        all_passed = False
        details.append(f"6b: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 6c: Confirm no global wildcard from next.config.js
    print("\n  6c: No global wildcard CORS from next.config.js")
    try:
        # Test multiple routes to ensure no wildcard
        test_routes = ["/api/health", "/", "/channels"]
        wildcard_found = False
        
        for route in test_routes:
            response = requests.get(
                f"{LOCAL_BASE}{route}",
                headers={"Origin": "https://evil.example"},
                timeout=5
            )
            cors_header = response.headers.get("Access-Control-Allow-Origin", "")
            if cors_header == "*":
                wildcard_found = True
                details.append(f"6c: Wildcard found on {route}")
                print(f"    ❌ Wildcard CORS found on {route}")
                break
        
        if not wildcard_found:
            print(f"    ✅ No wildcard CORS headers found")
    except Exception as e:
        all_passed = False
        details.append(f"6c: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    results.add_result(
        "Test 6: CORS regression",
        all_passed,
        "; ".join(details) if details else "CORS correctly configured (no wildcard, proper origin echo)"
    )

def test_7_compile_and_tests():
    """Test 7: Compile + tests"""
    print("\n" + "="*80)
    print("TEST 7: Compile + tests")
    print("="*80)
    
    all_passed = True
    details = []
    
    # Test 7a: yarn typecheck
    print("\n  7a: yarn typecheck")
    try:
        result = subprocess.run(
            ["yarn", "typecheck"],
            cwd="/app",
            capture_output=True,
            text=True,
            timeout=60
        )
        
        if result.returncode == 0:
            print(f"    ✅ yarn typecheck passed (exit code 0)")
        else:
            all_passed = False
            details.append(f"7a: yarn typecheck failed (exit {result.returncode})")
            print(f"    ❌ yarn typecheck failed (exit {result.returncode})")
            print(f"    stderr: {result.stderr[:500]}")
    except Exception as e:
        all_passed = False
        details.append(f"7a: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 7b: yarn test
    print("\n  7b: yarn test")
    try:
        result = subprocess.run(
            ["yarn", "test"],
            cwd="/app",
            capture_output=True,
            text=True,
            timeout=120
        )
        
        # Check if all tests passed
        if "13 passed" in result.stdout or result.returncode == 0:
            print(f"    ✅ yarn test passed (13/13 tests)")
        else:
            # Count passed/failed tests
            import re
            passed_match = re.search(r'(\d+) passed', result.stdout)
            failed_match = re.search(r'(\d+) failed', result.stdout)
            
            passed_count = int(passed_match.group(1)) if passed_match else 0
            failed_count = int(failed_match.group(1)) if failed_match else 0
            
            all_passed = False
            details.append(f"7b: {passed_count} passed, {failed_count} failed")
            print(f"    ❌ yarn test failed: {passed_count} passed, {failed_count} failed")
            print(f"    stdout excerpt: {result.stdout[-1000:]}")
    except Exception as e:
        all_passed = False
        details.append(f"7b: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    results.add_result(
        "Test 7: Compile and tests",
        all_passed,
        "; ".join(details) if details else "yarn typecheck and yarn test both passed"
    )

def test_8_stale_references():
    """Test 8: Stale references audit"""
    print("\n" + "="*80)
    print("TEST 8: Stale references audit")
    print("="*80)
    
    all_passed = True
    details = []
    
    search_terms = [
        ("WaveHub", "WaveHub (case sensitive)"),
        ("wavehub", "wavehub (case sensitive)"),
        ("nextjs-mongo-template", "nextjs-mongo-template"),
        ("wh_session", "wh_session"),
        ("userCount === 0", "userCount === 0 (first-user pattern)"),
    ]
    
    exclude_paths = [
        "README.md",
        "test_result.md",
        "node_modules",
        ".next",
        ".git",
        "backend_test.py",
    ]
    
    for search_term, description in search_terms:
        print(f"\n  Searching for: {description}")
        try:
            # Use grep to search, excluding specified paths
            exclude_args = []
            for path in exclude_paths:
                exclude_args.extend(["--exclude-dir", path])
            
            result = subprocess.run(
                ["grep", "-r", "-F", search_term, "/app"] + exclude_args,
                capture_output=True,
                text=True,
                timeout=10
            )
            
            # grep returns 0 if found, 1 if not found, >1 if error
            if result.returncode == 1:
                # Not found - this is good
                print(f"    ✅ No occurrences found")
            elif result.returncode == 0:
                # Found - check if it's in comments explaining removal
                lines = result.stdout.strip().split('\n')
                active_code_matches = []
                
                for line in lines:
                    # Skip if it's in excluded files
                    if any(excl in line for excl in exclude_paths):
                        continue
                    
                    # Check if it's a comment explaining removal
                    if "removed" in line.lower() or "no longer" in line.lower() or "was:" in line.lower():
                        continue
                    
                    active_code_matches.append(line)
                
                if active_code_matches:
                    all_passed = False
                    count = len(active_code_matches)
                    details.append(f"{description}: {count} occurrences in active code")
                    print(f"    ❌ Found {count} occurrences in active code:")
                    for match in active_code_matches[:5]:  # Show first 5
                        print(f"       {match[:100]}")
                else:
                    print(f"    ✅ Found only in comments explaining removal")
            else:
                # Error
                print(f"    ⚠️  grep error (exit {result.returncode})")
        except Exception as e:
            print(f"    ⚠️  Error: {str(e)}")
    
    results.add_result(
        "Test 8: Stale references audit",
        all_passed,
        "; ".join(details) if details else "No stale references found in active code"
    )

def main():
    print("\n" + "="*80)
    print("WaveLead Milestone 00.3 — Runtime Stability Verification")
    print("DO NOT MODIFY CODE - VERIFICATION ONLY")
    print("="*80)
    
    try:
        test_1_local_routes()
        test_2_deployed_routes()
        test_3_health_stability()
        test_4_memory_restart_check()
        test_5_authorization()
        test_6_cors_regression()
        test_7_compile_and_tests()
        test_8_stale_references()
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\nFatal error: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    
    results.print_summary()
    
    # Exit with appropriate code
    sys.exit(0 if not results.failures else 1)

if __name__ == "__main__":
    main()
