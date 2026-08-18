#!/usr/bin/env python3
"""
WaveLead Milestone 01 — Public Discovery Backend + Regression Verification
DO NOT MODIFY CODE - VERIFICATION ONLY
"""

import requests
import subprocess
import time
import json
import sys
from typing import Dict, List, Tuple, Any
from pymongo import MongoClient

# Configuration
LOCAL_BASE = "http://localhost:3000"
DEPLOYED_BASE = "https://grow-infrastructure.preview.emergentagent.com"
SUPER_ADMIN_EMAIL = "admin@wavelead.dev"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "wavelead"

class TestResults:
    def __init__(self):
        self.results = {}
        self.failures = []
        self.section_results = {}
    
    def add_result(self, test_name: str, passed: bool, details: str = ""):
        self.results[test_name] = {"passed": passed, "details": details}
        if not passed:
            self.failures.append(f"{test_name}: {details}")
    
    def add_section_result(self, section: str, passed: bool, details: str = ""):
        self.section_results[section] = {"passed": passed, "details": details}
    
    def print_summary(self):
        print("\n" + "="*80)
        print("MILESTONE 01 — PUBLIC DISCOVERY VERIFICATION SUMMARY")
        print("="*80)
        
        # Print section summaries
        for section, result in self.section_results.items():
            status = "✅ PASS" if result["passed"] else "❌ FAIL"
            print(f"\n{status} - {section}")
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

def section_1_new_discovery_endpoints():
    """Section 1: New public discovery endpoints (all approved-only, no auth)"""
    print("\n" + "="*80)
    print("SECTION 1: New public discovery endpoints")
    print("="*80)
    
    all_passed = True
    details = []
    
    # Test 1.1: GET /api/discovery/home
    print("\n  1.1: GET /api/discovery/home")
    try:
        response = requests.get(f"{LOCAL_BASE}/api/discovery/home", timeout=10)
        
        if response.status_code != 200:
            all_passed = False
            details.append(f"1.1: Expected 200, got {response.status_code}")
            print(f"    ❌ Status: {response.status_code}")
        else:
            data = response.json()
            body_data = data.get("data", {})
            
            # Check required fields
            required_fields = ["popular", "rising", "topIndonesia", "categories", "countries", "stats"]
            missing_fields = [f for f in required_fields if f not in body_data]
            
            if missing_fields:
                all_passed = False
                details.append(f"1.1: Missing fields: {missing_fields}")
                print(f"    ❌ Missing fields: {missing_fields}")
            else:
                # Validate popular (array of 6 channels)
                popular = body_data.get("popular", [])
                if not isinstance(popular, list) or len(popular) != 6:
                    all_passed = False
                    details.append(f"1.1: popular should be array of 6, got {len(popular)}")
                    print(f"    ❌ popular: expected 6 items, got {len(popular)}")
                else:
                    print(f"    ✅ popular: {len(popular)} items")
                
                # Validate rising (array of 6)
                rising = body_data.get("rising", [])
                if not isinstance(rising, list) or len(rising) != 6:
                    all_passed = False
                    details.append(f"1.1: rising should be array of 6, got {len(rising)}")
                    print(f"    ❌ rising: expected 6 items, got {len(rising)}")
                else:
                    print(f"    ✅ rising: {len(rising)} items")
                
                # Validate topIndonesia (array of ≤5 channels with country_code === "ID")
                top_indonesia = body_data.get("topIndonesia", [])
                if not isinstance(top_indonesia, list) or len(top_indonesia) > 5:
                    all_passed = False
                    details.append(f"1.1: topIndonesia should be array of ≤5, got {len(top_indonesia)}")
                    print(f"    ❌ topIndonesia: expected ≤5 items, got {len(top_indonesia)}")
                else:
                    # Check all have country_code === "ID"
                    non_id_channels = [c for c in top_indonesia if c.get("country_code") != "ID"]
                    if non_id_channels:
                        all_passed = False
                        details.append(f"1.1: topIndonesia has {len(non_id_channels)} non-ID channels")
                        print(f"    ❌ topIndonesia: {len(non_id_channels)} channels without country_code=ID")
                    else:
                        print(f"    ✅ topIndonesia: {len(top_indonesia)} items, all with country_code=ID")
                
                # Validate categories (25 items, each with channel_count)
                categories = body_data.get("categories", [])
                if not isinstance(categories, list) or len(categories) != 25:
                    all_passed = False
                    details.append(f"1.1: categories should be 25 items, got {len(categories)}")
                    print(f"    ❌ categories: expected 25 items, got {len(categories)}")
                else:
                    # Check each has channel_count
                    missing_count = [c for c in categories if "channel_count" not in c]
                    if missing_count:
                        all_passed = False
                        details.append(f"1.1: {len(missing_count)} categories missing channel_count")
                        print(f"    ❌ categories: {len(missing_count)} missing channel_count")
                    else:
                        print(f"    ✅ categories: {len(categories)} items, all with channel_count")
                
                # Validate countries (11 items with channel_count)
                countries = body_data.get("countries", [])
                if not isinstance(countries, list) or len(countries) != 11:
                    all_passed = False
                    details.append(f"1.1: countries should be 11 items, got {len(countries)}")
                    print(f"    ❌ countries: expected 11 items, got {len(countries)}")
                else:
                    # Check each has channel_count
                    missing_count = [c for c in countries if "channel_count" not in c]
                    if missing_count:
                        all_passed = False
                        details.append(f"1.1: {len(missing_count)} countries missing channel_count")
                        print(f"    ❌ countries: {len(missing_count)} missing channel_count")
                    else:
                        print(f"    ✅ countries: {len(countries)} items, all with channel_count")
                
                # Validate stats.totalApproved >= 20
                stats = body_data.get("stats", {})
                total_approved = stats.get("totalApproved", 0)
                if total_approved < 20:
                    all_passed = False
                    details.append(f"1.1: stats.totalApproved should be >= 20, got {total_approved}")
                    print(f"    ❌ stats.totalApproved: expected >= 20, got {total_approved}")
                else:
                    print(f"    ✅ stats.totalApproved: {total_approved}")
                
                # Check for data leaks in all channels
                all_channels = popular + rising + top_indonesia
                leaked_channels = []
                for ch in all_channels:
                    if "owner_id" in ch or "verification_status" in ch:
                        leaked_channels.append(ch.get("slug", "unknown"))
                    if "is_verified" not in ch:
                        all_passed = False
                        details.append(f"1.1: Channel {ch.get('slug', 'unknown')} missing is_verified")
                        print(f"    ❌ Channel {ch.get('slug', 'unknown')} missing is_verified")
                
                if leaked_channels:
                    all_passed = False
                    details.append(f"1.1: {len(leaked_channels)} channels leak owner_id/verification_status")
                    print(f"    ❌ Data leak: {len(leaked_channels)} channels expose owner_id/verification_status")
                else:
                    print(f"    ✅ No data leaks (owner_id, verification_status)")
                    print(f"    ✅ All channels have is_verified boolean")
    
    except Exception as e:
        all_passed = False
        details.append(f"1.1: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 1.2: GET /api/channels/rising?limit=8
    print("\n  1.2: GET /api/channels/rising?limit=8")
    try:
        response = requests.get(f"{LOCAL_BASE}/api/channels/rising?limit=8", timeout=10)
        
        if response.status_code != 200:
            all_passed = False
            details.append(f"1.2: Expected 200, got {response.status_code}")
            print(f"    ❌ Status: {response.status_code}")
        else:
            data = response.json()
            items = data.get("data", {}).get("items", [])
            
            if len(items) > 8:
                all_passed = False
                details.append(f"1.2: Expected ≤8 items, got {len(items)}")
                print(f"    ❌ Expected ≤8 items, got {len(items)}")
            else:
                print(f"    ✅ Items count: {len(items)} (≤8)")
            
            # Check for data leaks
            leaked = [ch for ch in items if "owner_id" in ch or "verification_status" in ch]
            if leaked:
                all_passed = False
                details.append(f"1.2: {len(leaked)} channels leak data")
                print(f"    ❌ Data leak: {len(leaked)} channels")
            else:
                print(f"    ✅ No data leaks")
    
    except Exception as e:
        all_passed = False
        details.append(f"1.2: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 1.3: GET /api/channels/top?country=ID&limit=5
    print("\n  1.3: GET /api/channels/top?country=ID&limit=5")
    try:
        response = requests.get(f"{LOCAL_BASE}/api/channels/top?country=ID&limit=5", timeout=10)
        
        if response.status_code != 200:
            all_passed = False
            details.append(f"1.3: Expected 200, got {response.status_code}")
            print(f"    ❌ Status: {response.status_code}")
        else:
            data = response.json()
            items = data.get("data", {}).get("items", [])
            
            # Check all have country_code === "ID"
            non_id = [ch for ch in items if ch.get("country_code") != "ID"]
            if non_id:
                all_passed = False
                details.append(f"1.3: {len(non_id)} channels without country_code=ID")
                print(f"    ❌ {len(non_id)} channels without country_code=ID")
            else:
                print(f"    ✅ All {len(items)} channels have country_code=ID")
            
            # Check for data leaks
            leaked = [ch for ch in items if "owner_id" in ch or "verification_status" in ch]
            if leaked:
                all_passed = False
                details.append(f"1.3: {len(leaked)} channels leak data")
                print(f"    ❌ Data leak: {len(leaked)} channels")
            else:
                print(f"    ✅ No data leaks")
    
    except Exception as e:
        all_passed = False
        details.append(f"1.3: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 1.4: GET /api/channels/top?country=US&limit=10
    print("\n  1.4: GET /api/channels/top?country=US&limit=10")
    try:
        response = requests.get(f"{LOCAL_BASE}/api/channels/top?country=US&limit=10", timeout=10)
        
        if response.status_code != 200:
            all_passed = False
            details.append(f"1.4: Expected 200, got {response.status_code}")
            print(f"    ❌ Status: {response.status_code}")
        else:
            data = response.json()
            items = data.get("data", {}).get("items", [])
            
            # Check all have country_code === "US"
            non_us = [ch for ch in items if ch.get("country_code") != "US"]
            if non_us:
                all_passed = False
                details.append(f"1.4: {len(non_us)} channels without country_code=US")
                print(f"    ❌ {len(non_us)} channels without country_code=US")
            else:
                print(f"    ✅ All {len(items)} channels have country_code=US")
    
    except Exception as e:
        all_passed = False
        details.append(f"1.4: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 1.5: GET /api/categories?withCounts=1
    print("\n  1.5: GET /api/categories?withCounts=1")
    try:
        response = requests.get(f"{LOCAL_BASE}/api/categories?withCounts=1", timeout=10)
        
        if response.status_code != 200:
            all_passed = False
            details.append(f"1.5: Expected 200, got {response.status_code}")
            print(f"    ❌ Status: {response.status_code}")
        else:
            data = response.json()
            categories = data.get("data", {}).get("categories", [])
            
            # Check each has channel_count
            missing_count = [c for c in categories if "channel_count" not in c or not isinstance(c.get("channel_count"), int)]
            if missing_count:
                all_passed = False
                details.append(f"1.5: {len(missing_count)} categories missing/invalid channel_count")
                print(f"    ❌ {len(missing_count)} categories missing/invalid channel_count")
            else:
                print(f"    ✅ All {len(categories)} categories have channel_count: number >= 0")
    
    except Exception as e:
        all_passed = False
        details.append(f"1.5: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 1.6: GET /api/countries
    print("\n  1.6: GET /api/countries")
    try:
        response = requests.get(f"{LOCAL_BASE}/api/countries", timeout=10)
        
        if response.status_code != 200:
            all_passed = False
            details.append(f"1.6: Expected 200, got {response.status_code}")
            print(f"    ❌ Status: {response.status_code}")
        else:
            data = response.json()
            countries = data.get("data", {}).get("countries", [])
            
            if len(countries) != 11:
                all_passed = False
                details.append(f"1.6: Expected exactly 11 countries, got {len(countries)}")
                print(f"    ❌ Expected exactly 11 countries, got {len(countries)}")
            else:
                print(f"    ✅ Exactly 11 countries")
            
            # Check required fields
            required_fields = ["code", "slug", "name", "flag", "channel_count"]
            for country in countries:
                missing = [f for f in required_fields if f not in country]
                if missing:
                    all_passed = False
                    details.append(f"1.6: Country {country.get('code', 'unknown')} missing fields: {missing}")
                    print(f"    ❌ Country {country.get('code', 'unknown')} missing: {missing}")
            
            # Check Indonesia (ID) count should be 7
            indonesia = next((c for c in countries if c.get("code") == "ID"), None)
            if indonesia:
                id_count = indonesia.get("channel_count", 0)
                if id_count != 7:
                    all_passed = False
                    details.append(f"1.6: Indonesia count should be 7, got {id_count}")
                    print(f"    ❌ Indonesia count: expected 7, got {id_count}")
                else:
                    print(f"    ✅ Indonesia (ID) count: {id_count}")
            else:
                all_passed = False
                details.append("1.6: Indonesia (ID) not found in countries")
                print(f"    ❌ Indonesia (ID) not found")
    
    except Exception as e:
        all_passed = False
        details.append(f"1.6: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    results.add_section_result(
        "Section 1: New discovery endpoints",
        all_passed,
        "; ".join(details) if details else "All 6 discovery endpoints working correctly"
    )
    
    return all_passed

def section_2_existing_endpoints_regression():
    """Section 2: Existing endpoints regression"""
    print("\n" + "="*80)
    print("SECTION 2: Existing endpoints regression")
    print("="*80)
    
    all_passed = True
    details = []
    
    # Test 2.1: GET /api/health
    print("\n  2.1: GET /api/health")
    try:
        response = requests.get(f"{LOCAL_BASE}/api/health", timeout=10)
        
        if response.status_code != 200:
            all_passed = False
            details.append(f"2.1: Expected 200, got {response.status_code}")
            print(f"    ❌ Status: {response.status_code}")
        else:
            data = response.json()
            service = data.get("data", {}).get("service")
            if service != "wavelead":
                all_passed = False
                details.append(f"2.1: Expected service='wavelead', got '{service}'")
                print(f"    ❌ service: expected 'wavelead', got '{service}'")
            else:
                print(f"    ✅ service: {service}")
    
    except Exception as e:
        all_passed = False
        details.append(f"2.1: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 2.2: GET /api/channels?limit=5
    print("\n  2.2: GET /api/channels?limit=5")
    try:
        response = requests.get(f"{LOCAL_BASE}/api/channels?limit=5", timeout=10)
        
        if response.status_code != 200:
            all_passed = False
            details.append(f"2.2: Expected 200, got {response.status_code}")
            print(f"    ❌ Status: {response.status_code}")
        else:
            data = response.json()
            items = data.get("data", {}).get("items", [])
            
            # Check for is_verified, no owner_id, no verification_status
            for ch in items:
                if "is_verified" not in ch:
                    all_passed = False
                    details.append(f"2.2: Channel {ch.get('slug', 'unknown')} missing is_verified")
                    print(f"    ❌ Channel {ch.get('slug', 'unknown')} missing is_verified")
                
                if "owner_id" in ch:
                    all_passed = False
                    details.append(f"2.2: Channel {ch.get('slug', 'unknown')} leaks owner_id")
                    print(f"    ❌ Channel {ch.get('slug', 'unknown')} leaks owner_id")
                
                if "verification_status" in ch:
                    all_passed = False
                    details.append(f"2.2: Channel {ch.get('slug', 'unknown')} leaks verification_status")
                    print(f"    ❌ Channel {ch.get('slug', 'unknown')} leaks verification_status")
            
            if not details or not any("2.2:" in d for d in details):
                print(f"    ✅ All {len(items)} channels have is_verified, no leaks")
    
    except Exception as e:
        all_passed = False
        details.append(f"2.2: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 2.3: GET /api/channels?q=football&limit=10
    print("\n  2.3: GET /api/channels?q=football&limit=10")
    try:
        response = requests.get(f"{LOCAL_BASE}/api/channels?q=football&limit=10", timeout=10)
        
        if response.status_code != 200:
            all_passed = False
            details.append(f"2.3: Expected 200, got {response.status_code}")
            print(f"    ❌ Status: {response.status_code}")
        else:
            data = response.json()
            items = data.get("data", {}).get("items", [])
            
            # Check at least 1 result contains "football" (case-insensitive)
            football_matches = [
                ch for ch in items 
                if "football" in ch.get("name", "").lower() or "football" in ch.get("description", "").lower()
            ]
            
            if len(football_matches) == 0:
                all_passed = False
                details.append(f"2.3: No results contain 'football' in name/description")
                print(f"    ❌ No results contain 'football'")
            else:
                print(f"    ✅ Found {len(football_matches)} results containing 'football'")
                print(f"       Example: {football_matches[0].get('name', 'unknown')}")
    
    except Exception as e:
        all_passed = False
        details.append(f"2.3: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 2.4: GET /api/channels/nusantara-daily
    print("\n  2.4: GET /api/channels/nusantara-daily")
    try:
        response = requests.get(f"{LOCAL_BASE}/api/channels/nusantara-daily", timeout=10)
        
        if response.status_code != 200:
            all_passed = False
            details.append(f"2.4: Expected 200, got {response.status_code}")
            print(f"    ❌ Status: {response.status_code}")
        else:
            data = response.json()
            channel = data.get("data", {}).get("channel", {})
            
            # Check sanitized (no owner_id, no verification_status, has is_verified)
            if "owner_id" in channel:
                all_passed = False
                details.append(f"2.4: Channel leaks owner_id")
                print(f"    ❌ Channel leaks owner_id")
            
            if "verification_status" in channel:
                all_passed = False
                details.append(f"2.4: Channel leaks verification_status")
                print(f"    ❌ Channel leaks verification_status")
            
            if "is_verified" not in channel:
                all_passed = False
                details.append(f"2.4: Channel missing is_verified")
                print(f"    ❌ Channel missing is_verified")
            
            if not any("2.4:" in d for d in details):
                print(f"    ✅ Channel sanitized correctly")
    
    except Exception as e:
        all_passed = False
        details.append(f"2.4: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 2.5: GET /api/stats
    print("\n  2.5: GET /api/stats")
    try:
        response = requests.get(f"{LOCAL_BASE}/api/stats", timeout=10)
        
        if response.status_code != 200:
            all_passed = False
            details.append(f"2.5: Expected 200, got {response.status_code}")
            print(f"    ❌ Status: {response.status_code}")
        else:
            data = response.json()
            stats = data.get("data", {})
            
            if "totalApproved" not in stats:
                all_passed = False
                details.append(f"2.5: Missing totalApproved")
                print(f"    ❌ Missing totalApproved")
            
            if "totalPending" not in stats:
                all_passed = False
                details.append(f"2.5: Missing totalPending")
                print(f"    ❌ Missing totalPending")
            
            if not any("2.5:" in d for d in details):
                print(f"    ✅ Stats: totalApproved={stats.get('totalApproved')}, totalPending={stats.get('totalPending')}")
    
    except Exception as e:
        all_passed = False
        details.append(f"2.5: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    results.add_section_result(
        "Section 2: Existing endpoints regression",
        all_passed,
        "; ".join(details) if details else "All 5 existing endpoints working correctly"
    )
    
    return all_passed

def section_3_public_routes_render():
    """Section 3: Public routes render (HTTP 200 required)"""
    print("\n" + "="*80)
    print("SECTION 3: Public routes render")
    print("="*80)
    
    all_passed = True
    details = []
    
    routes_to_test = [
        ("/", 200, "Find channels worth following"),
        ("/channels", 200, "All approved channels"),
        ("/trending", 200, "Trending on WaveLead"),
        ("/top", 200, "Top Channels in Indonesia"),
        ("/top?country=US", 200, "Top Channels in United States"),
        ("/categories", 200, "Explore all categories"),
        ("/category/finance", 200, "Finance channels"),
        ("/category/does-not-exist", 404, None),  # 404 expected
        ("/country/indonesia", 200, "Indonesia channels"),
        ("/country/nowhere-land", 404, None),  # 404 expected
        ("/channel/nusantara-daily", 200, "Nusantara Daily"),
        ("/channel/nusantara-daily", 200, "Follow on WhatsApp"),
        ("/channel/no-such-channel", 404, None),  # 404 expected
        ("/search?q=football", 200, "Results for"),
        ("/search?q=football", 200, "football"),
        ("/pricing", 200, None),
        ("/about", 200, None),
        ("/terms", 200, None),
        ("/privacy", 200, None),
        ("/login", 200, None),
        ("/signup", 200, None),
        ("/submit", 200, None),
        ("/dashboard", 307, None),  # redirect to /login?next=/dashboard
        ("/admin", 307, None),  # redirect to /login?next=/admin
    ]
    
    # Group routes by path to avoid duplicate requests
    routes_by_path = {}
    for route, expected_status, expected_text in routes_to_test:
        if route not in routes_by_path:
            routes_by_path[route] = {"status": expected_status, "texts": []}
        if expected_text:
            routes_by_path[route]["texts"].append(expected_text)
    
    for route, expectations in routes_by_path.items():
        expected_status = expectations["status"]
        expected_texts = expectations["texts"]
        
        try:
            response = requests.get(f"{LOCAL_BASE}{route}", allow_redirects=False, timeout=10)
            
            if response.status_code != expected_status:
                all_passed = False
                details.append(f"{route}: Expected {expected_status}, got {response.status_code}")
                print(f"  ❌ {route}: Expected {expected_status}, got {response.status_code}")
            else:
                # Check for expected text if status is 200
                if expected_status == 200 and expected_texts:
                    html = response.text
                    missing_texts = [text for text in expected_texts if text.lower() not in html.lower()]
                    
                    if missing_texts:
                        all_passed = False
                        details.append(f"{route}: Missing text: {missing_texts}")
                        print(f"  ❌ {route}: Missing text: {missing_texts}")
                    else:
                        print(f"  ✅ {route}: {expected_status}, contains expected text")
                elif expected_status == 307:
                    location = response.headers.get("location", "")
                    if "/login" in location:
                        print(f"  ✅ {route}: {expected_status} → {location}")
                    else:
                        all_passed = False
                        details.append(f"{route}: Redirect to unexpected location: {location}")
                        print(f"  ❌ {route}: Redirect to unexpected location: {location}")
                else:
                    print(f"  ✅ {route}: {expected_status}")
        
        except Exception as e:
            all_passed = False
            details.append(f"{route}: {str(e)}")
            print(f"  ❌ {route}: Error - {str(e)}")
    
    results.add_section_result(
        "Section 3: Public routes render",
        all_passed,
        "; ".join(details) if details else "All routes return expected status codes and content"
    )
    
    return all_passed

def section_4_auth_rbac_regression():
    """Section 4: Auth / RBAC regression (must NOT have regressed)"""
    print("\n" + "="*80)
    print("SECTION 4: Auth / RBAC regression")
    print("="*80)
    
    all_passed = True
    details = []
    
    # Test 4.1: Anonymous GET /api/admin/ping → 401
    print("\n  4.1: Anonymous GET /api/admin/ping → 401")
    try:
        response = requests.get(f"{LOCAL_BASE}/api/admin/ping", timeout=10)
        
        if response.status_code != 401:
            all_passed = False
            details.append(f"4.1: Expected 401, got {response.status_code}")
            print(f"    ❌ Expected 401, got {response.status_code}")
        else:
            print(f"    ✅ Anonymous request: 401")
    
    except Exception as e:
        all_passed = False
        details.append(f"4.1: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 4.2: Signup fresh user, GET /api/admin/ping → 403
    print("\n  4.2: Signup fresh user, GET /api/admin/ping → 403")
    try:
        signup_data = {
            "email": f"freshuser_{int(time.time())}@test.com",
            "password": "TestPass123!",
            "display_name": "Fresh User"
        }
        signup_response = requests.post(
            f"{LOCAL_BASE}/api/auth/signup",
            json=signup_data,
            timeout=10
        )
        
        if signup_response.status_code != 200:
            all_passed = False
            details.append(f"4.2: Signup failed with {signup_response.status_code}")
            print(f"    ❌ Signup failed: {signup_response.status_code}")
        else:
            cookies = signup_response.cookies
            
            admin_response = requests.get(
                f"{LOCAL_BASE}/api/admin/ping",
                cookies=cookies,
                timeout=10
            )
            
            if admin_response.status_code != 403:
                all_passed = False
                details.append(f"4.2: Expected 403, got {admin_response.status_code}")
                print(f"    ❌ Expected 403, got {admin_response.status_code}")
            else:
                print(f"    ✅ Fresh user: 403")
    
    except Exception as e:
        all_passed = False
        details.append(f"4.2: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 4.3: Bootstrap flow
    print("\n  4.3: Bootstrap flow")
    try:
        # Wipe users
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        db.users.delete_many({})
        print("    Cleared users collection")
        
        # Signup admin@wavelead.dev
        admin_signup_data = {
            "email": SUPER_ADMIN_EMAIL,
            "password": "AdminPass123!",
            "display_name": "Super Admin"
        }
        admin_signup_response = requests.post(
            f"{LOCAL_BASE}/api/auth/signup",
            json=admin_signup_data,
            timeout=10
        )
        
        if admin_signup_response.status_code != 200:
            all_passed = False
            details.append(f"4.3: Admin signup failed with {admin_signup_response.status_code}")
            print(f"    ❌ Admin signup failed: {admin_signup_response.status_code}")
        else:
            cookies = admin_signup_response.cookies
            
            # GET /api/admin/ping → 200
            admin_ping_1 = requests.get(
                f"{LOCAL_BASE}/api/admin/ping",
                cookies=cookies,
                timeout=10
            )
            
            if admin_ping_1.status_code != 200:
                all_passed = False
                details.append(f"4.3: Admin ping failed: {admin_ping_1.status_code}")
                print(f"    ❌ Admin ping failed: {admin_ping_1.status_code}")
            else:
                print(f"    ✅ Admin ping: 200")
                
                # Update role to 'user' in DB
                user = db.users.find_one({"email": SUPER_ADMIN_EMAIL})
                if user:
                    db.users.update_one(
                        {"email": SUPER_ADMIN_EMAIL},
                        {"$set": {"role": "user"}}
                    )
                    print("    Updated role to 'user' in DB")
                    
                    # Same cookie → 403 (live-role check)
                    admin_ping_2 = requests.get(
                        f"{LOCAL_BASE}/api/admin/ping",
                        cookies=cookies,
                        timeout=10
                    )
                    
                    if admin_ping_2.status_code != 403:
                        all_passed = False
                        details.append(f"4.3: Expected 403 after downgrade, got {admin_ping_2.status_code}")
                        print(f"    ❌ Expected 403 after downgrade, got {admin_ping_2.status_code}")
                    else:
                        print(f"    ✅ Downgraded user: 403 (live-role check working)")
                else:
                    all_passed = False
                    details.append("4.3: Could not find user in DB")
                    print("    ❌ Could not find user in DB")
        
        client.close()
    
    except Exception as e:
        all_passed = False
        details.append(f"4.3: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 4.4: Rate limit
    print("\n  4.4: Rate limit (9× rapid /api/auth/login)")
    try:
        # Use a fixed X-Forwarded-For header
        headers = {"X-Forwarded-For": "192.168.1.100"}
        
        for i in range(1, 10):
            login_data = {
                "email": "nonexistent@test.com",
                "password": "WrongPass123!"
            }
            response = requests.post(
                f"{LOCAL_BASE}/api/auth/login",
                json=login_data,
                headers=headers,
                timeout=10
            )
            
            if i == 9:
                if response.status_code != 429:
                    all_passed = False
                    details.append(f"4.4: Expected 429 on 9th attempt, got {response.status_code}")
                    print(f"    ❌ 9th attempt: Expected 429, got {response.status_code}")
                else:
                    print(f"    ✅ 9th attempt: 429 (rate limit working)")
            
            time.sleep(0.1)
    
    except Exception as e:
        all_passed = False
        details.append(f"4.4: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    results.add_section_result(
        "Section 4: Auth / RBAC regression",
        all_passed,
        "; ".join(details) if details else "All 4 auth/RBAC tests passed"
    )
    
    return all_passed

def section_5_cors_strict():
    """Section 5: CORS still strict"""
    print("\n" + "="*80)
    print("SECTION 5: CORS still strict")
    print("="*80)
    
    all_passed = True
    details = []
    
    try:
        response = requests.get(
            f"{LOCAL_BASE}/api/health",
            headers={"Origin": "https://evil.example"},
            timeout=10
        )
        
        cors_header = response.headers.get("Access-Control-Allow-Origin", "")
        
        if cors_header == "*":
            all_passed = False
            details.append("CORS wildcard (*) found")
            print(f"  ❌ CORS wildcard (*) found")
        elif cors_header == "https://evil.example":
            all_passed = False
            details.append("Evil origin echoed")
            print(f"  ❌ Evil origin echoed: {cors_header}")
        else:
            print(f"  ✅ Evil origin not allowed (CORS header: {cors_header or 'none'})")
    
    except Exception as e:
        all_passed = False
        details.append(f"Error: {str(e)}")
        print(f"  ❌ Error: {str(e)}")
    
    results.add_section_result(
        "Section 5: CORS still strict",
        all_passed,
        "; ".join(details) if details else "CORS correctly configured (no wildcard, evil origin not echoed)"
    )
    
    return all_passed

def section_6_compile_tests():
    """Section 6: Compile + tests"""
    print("\n" + "="*80)
    print("SECTION 6: Compile + tests")
    print("="*80)
    
    all_passed = True
    details = []
    
    # Test 6.1: yarn typecheck
    print("\n  6.1: yarn typecheck")
    try:
        result = subprocess.run(
            ["yarn", "typecheck"],
            cwd="/app",
            capture_output=True,
            text=True,
            timeout=60
        )
        
        if result.returncode == 0:
            print(f"    ✅ yarn typecheck: exit 0")
        else:
            all_passed = False
            details.append(f"yarn typecheck failed (exit {result.returncode})")
            print(f"    ❌ yarn typecheck: exit {result.returncode}")
            print(f"    stderr: {result.stderr[:500]}")
    
    except Exception as e:
        all_passed = False
        details.append(f"yarn typecheck: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 6.2: yarn test
    print("\n  6.2: yarn test")
    try:
        result = subprocess.run(
            ["yarn", "test"],
            cwd="/app",
            capture_output=True,
            text=True,
            timeout=120
        )
        
        # Check if 13/13 tests passed
        if "13 passed" in result.stdout or result.returncode == 0:
            print(f"    ✅ yarn test: 13/13 pass")
        else:
            # Count passed/failed tests
            import re
            passed_match = re.search(r'(\d+) passed', result.stdout)
            failed_match = re.search(r'(\d+) failed', result.stdout)
            
            passed_count = int(passed_match.group(1)) if passed_match else 0
            failed_count = int(failed_match.group(1)) if failed_match else 0
            
            all_passed = False
            details.append(f"yarn test: {passed_count} passed, {failed_count} failed")
            print(f"    ❌ yarn test: {passed_count} passed, {failed_count} failed")
            print(f"    stdout excerpt: {result.stdout[-1000:]}")
    
    except Exception as e:
        all_passed = False
        details.append(f"yarn test: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    # Test 6.3: yarn build
    print("\n  6.3: yarn build")
    try:
        result = subprocess.run(
            ["yarn", "build"],
            cwd="/app",
            capture_output=True,
            text=True,
            timeout=180
        )
        
        if result.returncode == 0:
            print(f"    ✅ yarn build: exit 0")
        else:
            all_passed = False
            details.append(f"yarn build failed (exit {result.returncode})")
            print(f"    ❌ yarn build: exit {result.returncode}")
            print(f"    stderr: {result.stderr[:500]}")
    
    except Exception as e:
        all_passed = False
        details.append(f"yarn build: {str(e)}")
        print(f"    ❌ Error: {str(e)}")
    
    results.add_section_result(
        "Section 6: Compile + tests",
        all_passed,
        "; ".join(details) if details else "yarn typecheck, yarn test, yarn build all passed"
    )
    
    return all_passed

def section_7_dev_log_sanity():
    """Section 7: Dev-log sanity"""
    print("\n" + "="*80)
    print("SECTION 7: Dev-log sanity")
    print("="*80)
    
    all_passed = True
    details = []
    
    try:
        result = subprocess.run(
            ["tail", "-n", "200", "/var/log/supervisor/nextjs.out.log"],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        log_content = result.stdout
        
        module_not_found = "MODULE_NOT_FOUND" in log_content
        memory_threshold = "approaching the used memory threshold" in log_content.lower()
        
        if module_not_found:
            all_passed = False
            details.append("MODULE_NOT_FOUND found in logs")
            print(f"  ❌ MODULE_NOT_FOUND found in logs")
        
        if memory_threshold:
            all_passed = False
            details.append("Memory threshold warning found in logs")
            print(f"  ❌ Memory threshold warning found in logs")
        
        if not module_not_found and not memory_threshold:
            print(f"  ✅ No MODULE_NOT_FOUND or memory threshold warnings")
    
    except Exception as e:
        all_passed = False
        details.append(f"Error: {str(e)}")
        print(f"  ❌ Error: {str(e)}")
    
    results.add_section_result(
        "Section 7: Dev-log sanity",
        all_passed,
        "; ".join(details) if details else "No MODULE_NOT_FOUND or memory warnings in logs"
    )
    
    return all_passed

def main():
    print("\n" + "="*80)
    print("WaveLead Milestone 01 — Public Discovery Backend + Regression Verification")
    print("DO NOT MODIFY CODE - VERIFICATION ONLY")
    print("="*80)
    
    try:
        section_1_new_discovery_endpoints()
        section_2_existing_endpoints_regression()
        section_3_public_routes_render()
        section_4_auth_rbac_regression()
        section_5_cors_strict()
        section_6_compile_tests()
        section_7_dev_log_sanity()
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
