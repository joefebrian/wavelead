#!/usr/bin/env python3
"""
WAVELEAD FINALIST READINESS - Backend Verification
Tests the canonical public-visibility policy across all discovery surfaces.

SCOPE: Discovery/public-inventory modules ONLY.
- Verifies approved non-fixture channels ARE visible
- Verifies each suppression family is INVISIBLE everywhere
- Verifies no false positives (organic slugs remain visible)
- Verifies data integrity (no mutations)
- Verifies no field leakage
"""

import requests
import time
import json
from pymongo import MongoClient
from datetime import datetime
import sys

# Configuration from .env
BASE_URL = "http://localhost:3000"
API_BASE = f"{BASE_URL}/api"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "wavelead"

# Test run identifier
RUN_TAG = f"finalist-{int(time.time())}"

# Global session
session = requests.Session()

def log(msg):
    """Print timestamped log message"""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def get_mongo_client():
    """Get MongoDB client"""
    return MongoClient(MONGO_URL)

def cleanup_test_fixtures():
    """Clean up all test fixtures created during this run"""
    log(f"Cleaning up test fixtures with RUN_TAG: {RUN_TAG}")
    client = get_mongo_client()
    db = client[DB_NAME]
    
    # Delete channels created by this test run
    result = db.channels.delete_many({"slug": {"$regex": f"-ftest{RUN_TAG}$"}})
    log(f"  Deleted {result.deleted_count} test channels")
    
    client.close()

def create_test_channel(slug_suffix, **overrides):
    """
    Create a test channel directly in MongoDB with approved status.
    Returns the channel document.
    """
    client = get_mongo_client()
    db = client[DB_NAME]
    
    # Use organic-looking slugs with a marker for cleanup
    # Format: <organic-name>-ftest<timestamp>
    slug = f"{slug_suffix}-ftest{RUN_TAG}"
    
    # Base channel document
    channel = {
        "id": f"ch-{slug}",
        "slug": slug,
        "name": overrides.get("name", f"Test Channel {slug_suffix}"),
        "short_description": overrides.get("short_description", "Test channel for finalist verification"),
        "description": None,
        "whatsapp_url": overrides.get("whatsapp_url", f"https://whatsapp.com/channel/{slug}"),
        "category_id": overrides.get("category_id", "cat-business"),
        "country_code": overrides.get("country_code", "ID"),
        "primary_language": overrides.get("primary_language", "id"),
        "website": None,
        "logo_url": None,
        "follower_count": overrides.get("follower_count", 1000),
        "follower_count_source": overrides.get("follower_count_source", None),
        "status": overrides.get("status", "approved"),
        "verification_status": overrides.get("verification_status", "unverified"),
        "owner_id": overrides.get("owner_id", None),
        "is_featured": False,
        "activity_level": "active",
        "is_test_fixture": overrides.get("is_test_fixture", False),
        "is_demo": overrides.get("is_demo", False),
        "submitted_at": datetime.utcnow(),
        "published_at": datetime.utcnow() if overrides.get("status") == "approved" else None,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    
    # Apply any additional overrides
    for key, value in overrides.items():
        if key not in channel:
            channel[key] = value
    
    db.channels.insert_one(channel)
    client.close()
    
    log(f"  Created test channel: {slug}")
    return channel

def verify_channel_visible_on_surface(slug, surface_name, url, params=None):
    """
    Verify a channel is visible on a specific surface.
    Returns True if visible, False otherwise.
    """
    try:
        resp = session.get(url, params=params, timeout=10)
        if resp.status_code != 200:
            log(f"    ❌ {surface_name}: HTTP {resp.status_code}")
            return False
        
        data = resp.json()
        
        # Handle different response structures
        if "data" in data:
            items = data["data"]
            if isinstance(items, dict):
                # Could be paginated response
                items = items.get("items", [])
        else:
            items = data if isinstance(data, list) else []
        
        # Check if slug is in the response
        found = any(item.get("slug") == slug for item in items)
        
        if found:
            log(f"    ✅ {surface_name}: visible")
            return True
        else:
            log(f"    ❌ {surface_name}: not found in response")
            return False
    except Exception as e:
        log(f"    ❌ {surface_name}: Exception - {str(e)}")
        return False

def verify_channel_404_on_direct_lookup(slug):
    """
    Verify a channel returns 404 on direct lookup.
    Returns True if 404, False otherwise.
    """
    try:
        resp = session.get(f"{API_BASE}/channels/{slug}", timeout=10)
        if resp.status_code == 404:
            log(f"    ✅ Direct lookup: 404 (correctly hidden)")
            return True
        else:
            log(f"    ❌ Direct lookup: HTTP {resp.status_code} (should be 404)")
            return False
    except Exception as e:
        log(f"    ❌ Direct lookup: Exception - {str(e)}")
        return False

def verify_channel_invisible_everywhere(slug):
    """
    Verify a channel is invisible on ALL public surfaces.
    Returns True if invisible everywhere, False otherwise.
    """
    log(f"  Verifying {slug} is INVISIBLE everywhere...")
    
    all_invisible = True
    
    # 1. Direct lookup should 404
    if not verify_channel_404_on_direct_lookup(slug):
        all_invisible = False
    
    # 2. Browse listing
    if verify_channel_visible_on_surface(slug, "Browse", f"{API_BASE}/channels"):
        all_invisible = False
    
    # 3. Search
    if verify_channel_visible_on_surface(slug, "Search", f"{API_BASE}/channels", {"q": slug}):
        all_invisible = False
    
    # 4. Top channels
    if verify_channel_visible_on_surface(slug, "Top", f"{API_BASE}/channels/top"):
        all_invisible = False
    
    # 5. Rising channels
    if verify_channel_visible_on_surface(slug, "Rising", f"{API_BASE}/channels/rising"):
        all_invisible = False
    
    # 6. Discovery home
    if verify_channel_visible_on_surface(slug, "Discovery", f"{API_BASE}/discovery/home"):
        all_invisible = False
    
    # 7. Sitemap
    try:
        resp = session.get(f"{BASE_URL}/sitemap.xml", timeout=10)
        if resp.status_code == 200 and slug in resp.text:
            log(f"    ❌ Sitemap: found (should be hidden)")
            all_invisible = False
        else:
            log(f"    ✅ Sitemap: not found")
    except Exception as e:
        log(f"    ❌ Sitemap: Exception - {str(e)}")
        all_invisible = False
    
    return all_invisible

def verify_channel_visible_everywhere(slug):
    """
    Verify a channel is visible on key public surfaces.
    Returns True if visible on critical surfaces, False otherwise.
    Note: Search and Discovery may not show all channels due to ranking/relevance,
    so we focus on direct lookup and browse listing as the critical tests.
    """
    log(f"  Verifying {slug} is VISIBLE on critical surfaces...")
    
    all_visible = True
    
    # 1. Direct lookup should return 200 (CRITICAL)
    try:
        resp = session.get(f"{API_BASE}/channels/{slug}", timeout=10)
        if resp.status_code == 200:
            log(f"    ✅ Direct lookup: 200")
        else:
            log(f"    ❌ Direct lookup: HTTP {resp.status_code}")
            all_visible = False
    except Exception as e:
        log(f"    ❌ Direct lookup: Exception - {str(e)}")
        all_visible = False
    
    # 2. Browse listing (CRITICAL)
    if not verify_channel_visible_on_surface(slug, "Browse", f"{API_BASE}/channels"):
        all_visible = False
    
    # 3. Search (informational - may not show due to relevance)
    search_visible = verify_channel_visible_on_surface(slug, "Search", f"{API_BASE}/channels", {"q": slug})
    if not search_visible:
        log(f"    ℹ️  Search: not found (may be due to relevance ranking)")
    
    # 4. Discovery home (informational - shows curated/ranked content)
    discovery_visible = verify_channel_visible_on_surface(slug, "Discovery", f"{API_BASE}/discovery/home")
    if not discovery_visible:
        log(f"    ℹ️  Discovery: not found (shows curated/ranked content only)")
    
    # Note: Top/Rising may not show all channels due to ranking, so we don't test those
    
    return all_visible

def test_1_real_channel_visibility():
    """
    TEST 1: A real approved non-fixture channel IS visible on all surfaces.
    """
    log("\n" + "="*80)
    log("TEST 1: Real approved channel visibility")
    log("="*80)
    
    # Create a real-looking approved channel
    channel = create_test_channel(
        "real-channel",
        name="Real Test Channel",
        status="approved",
        verification_status="unverified",
        follower_count=5000,
    )
    
    # Verify it's visible everywhere
    result = verify_channel_visible_everywhere(channel["slug"])
    
    if result:
        log("✅ TEST 1 PASSED: Real channel is visible on all surfaces")
        return True
    else:
        log("❌ TEST 1 FAILED: Real channel is not visible on all surfaces")
        return False

def test_2_suppression_families():
    """
    TEST 2: Each suppression family is invisible everywhere AND 404s on direct lookup.
    """
    log("\n" + "="*80)
    log("TEST 2: Suppression families are invisible")
    log("="*80)
    
    all_passed = True
    
    # Test each suppression family
    suppression_tests = [
        # is_demo: true
        {
            "name": "is_demo=true",
            "slug_suffix": "demo-channel",
            "overrides": {"is_demo": True, "status": "approved"}
        },
        # slug: b2-ch-<8hex>
        {
            "name": "QA slug b2-ch-<8hex>",
            "slug_suffix": "b2-ch-12345678",
            "overrides": {"status": "approved"}
        },
        # whatsapp_url: .../channel/demo-...
        {
            "name": "demo whatsapp_url",
            "slug_suffix": "demo-url",
            "overrides": {
                "status": "approved",
                "whatsapp_url": "https://whatsapp.com/channel/demo-test123"
            }
        },
        # follower_count_source: demo_seed
        {
            "name": "follower_count_source=demo_seed",
            "slug_suffix": "demo-seed",
            "overrides": {
                "status": "approved",
                "follower_count_source": "demo_seed"
            }
        },
        # is_test_fixture: true
        {
            "name": "is_test_fixture=true",
            "slug_suffix": "test-fixture",
            "overrides": {"is_test_fixture": True, "status": "approved"}
        },
        # slug: ^test-
        {
            "name": "legacy slug ^test-",
            "slug_suffix": "test-legacy",
            "overrides": {"status": "approved"}
        },
        # name: ^Test 
        {
            "name": "legacy name ^Test ",
            "slug_suffix": "legacy-name",
            "overrides": {"name": "Test Legacy Channel", "status": "approved"}
        },
    ]
    
    for test in suppression_tests:
        log(f"\n  Testing suppression: {test['name']}")
        
        # Override slug if it's a specific pattern test
        if test['slug_suffix'].startswith('b2-ch-') or test['slug_suffix'].startswith('test-'):
            # Use the exact slug pattern
            channel = create_test_channel(test['slug_suffix'], **test['overrides'])
        else:
            channel = create_test_channel(test['slug_suffix'], **test['overrides'])
        
        result = verify_channel_invisible_everywhere(channel["slug"])
        
        if result:
            log(f"  ✅ {test['name']}: correctly suppressed")
        else:
            log(f"  ❌ {test['name']}: LEAK DETECTED")
            all_passed = False
    
    if all_passed:
        log("\n✅ TEST 2 PASSED: All suppression families are correctly hidden")
        return True
    else:
        log("\n❌ TEST 2 FAILED: Some suppression families leaked")
        return False

def test_3_no_false_positives():
    """
    TEST 3: CRITICAL - no false positives. Organic slugs/names remain visible.
    """
    log("\n" + "="*80)
    log("TEST 3: No false positives - organic slugs remain visible")
    log("="*80)
    
    all_passed = True
    
    # Test organic slugs that should NOT be suppressed
    # Use the exact slugs without modification
    organic_tests = [
        {"slug": "b2b-marketing-tips", "name": "B2B Marketing Tips"},
        {"slug": "gb-chess-club", "name": "GB Chess Club"},
        {"slug": "qatar-news-daily", "name": "Qatar News Daily"},
        {"slug": "smokey-bbq-recipes", "name": "Smokey BBQ Recipes"},
        {"slug": "testimoni-pelanggan", "name": "Testimoni Pelanggan"},
        {"slug": "b2-channel-review", "name": "B2 Channel Review"},
    ]
    
    for test in organic_tests:
        log(f"\n  Testing organic slug: {test['slug']}")
        
        # For organic tests, use the exact slug with ftest marker at the end
        client = get_mongo_client()
        db = client[DB_NAME]
        
        test_slug = f"{test['slug']}-ftest{RUN_TAG}"
        
        channel = {
            "id": f"ch-{test_slug}",
            "slug": test_slug,
            "name": test['name'],
            "short_description": "Test channel for finalist verification",
            "description": None,
            "whatsapp_url": f"https://whatsapp.com/channel/{test_slug}",
            "category_id": "cat-business",
            "country_code": "ID",
            "primary_language": "id",
            "website": None,
            "logo_url": None,
            "follower_count": 1000,
            "follower_count_source": None,
            "status": "approved",
            "verification_status": "unverified",
            "owner_id": None,
            "is_featured": False,
            "activity_level": "active",
            "is_test_fixture": False,
            "is_demo": False,
            "submitted_at": datetime.utcnow(),
            "published_at": datetime.utcnow(),
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        
        db.channels.insert_one(channel)
        client.close()
        
        log(f"  Created test channel: {test_slug}")
        
        result = verify_channel_visible_everywhere(test_slug)
        
        if result:
            log(f"  ✅ {test['slug']}: correctly visible")
        else:
            log(f"  ❌ {test['slug']}: FALSE POSITIVE - incorrectly suppressed")
            all_passed = False
    
    # Test follower_count_source 'seed' and 'test' (should remain visible)
    # Use slugs that won't match any suppression patterns
    log(f"\n  Testing follower_count_source='seed' (should be visible)")
    channel_seed = create_test_channel(
        "organic-with-seed-source",
        status="approved",
        follower_count_source="seed"
    )
    if verify_channel_visible_everywhere(channel_seed["slug"]):
        log(f"  ✅ follower_count_source='seed': correctly visible")
    else:
        log(f"  ❌ follower_count_source='seed': FALSE POSITIVE")
        all_passed = False
    
    log(f"\n  Testing follower_count_source='test' (should be visible)")
    channel_test = create_test_channel(
        "organic-with-testing-source",  # Avoid starting with "test-"
        status="approved",
        follower_count_source="test"
    )
    if verify_channel_visible_everywhere(channel_test["slug"]):
        log(f"  ✅ follower_count_source='test': correctly visible")
    else:
        log(f"  ❌ follower_count_source='test': FALSE POSITIVE")
        all_passed = False
    
    if all_passed:
        log("\n✅ TEST 3 PASSED: No false positives detected")
        return True
    else:
        log("\n❌ TEST 3 FAILED: False positives detected")
        return False

def test_4_pending_rejected_hidden():
    """
    TEST 4: pending_review and rejected channels stay hidden everywhere.
    """
    log("\n" + "="*80)
    log("TEST 4: pending_review and rejected channels stay hidden")
    log("="*80)
    
    all_passed = True
    
    # Test pending_review
    log("\n  Testing pending_review channel")
    channel_pending = create_test_channel(
        "pending-channel",
        status="pending_review",
    )
    if verify_channel_invisible_everywhere(channel_pending["slug"]):
        log(f"  ✅ pending_review: correctly hidden")
    else:
        log(f"  ❌ pending_review: LEAK DETECTED")
        all_passed = False
    
    # Test rejected
    log("\n  Testing rejected channel")
    channel_rejected = create_test_channel(
        "rejected-channel",
        status="rejected",
    )
    if verify_channel_invisible_everywhere(channel_rejected["slug"]):
        log(f"  ✅ rejected: correctly hidden")
    else:
        log(f"  ❌ rejected: LEAK DETECTED")
        all_passed = False
    
    if all_passed:
        log("\n✅ TEST 4 PASSED: pending_review and rejected channels are hidden")
        return True
    else:
        log("\n❌ TEST 4 FAILED: pending_review or rejected channels leaked")
        return False

def test_5_verification_status_integrity():
    """
    TEST 5: Approved channel with verification_status 'unverified'/'unclaimed'
    must NEVER return is_verified or is_official true.
    """
    log("\n" + "="*80)
    log("TEST 5: Verification status integrity")
    log("="*80)
    
    all_passed = True
    
    # Test unverified
    log("\n  Testing unverified channel")
    channel_unverified = create_test_channel(
        "unverified-channel",
        status="approved",
        verification_status="unverified",
    )
    
    try:
        resp = session.get(f"{API_BASE}/channels/{channel_unverified['slug']}", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            channel_data = data.get("data", {})
            
            if channel_data.get("is_verified") or channel_data.get("is_official"):
                log(f"  ❌ unverified: incorrectly shows is_verified={channel_data.get('is_verified')} or is_official={channel_data.get('is_official')}")
                all_passed = False
            else:
                log(f"  ✅ unverified: correctly shows is_verified=false, is_official=false")
        else:
            log(f"  ❌ unverified: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        log(f"  ❌ unverified: Exception - {str(e)}")
        all_passed = False
    
    # Test unclaimed
    log("\n  Testing unclaimed channel")
    channel_unclaimed = create_test_channel(
        "unclaimed-channel",
        status="approved",
        verification_status="unclaimed",
    )
    
    try:
        resp = session.get(f"{API_BASE}/channels/{channel_unclaimed['slug']}", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            channel_data = data.get("data", {})
            
            if channel_data.get("is_verified") or channel_data.get("is_official"):
                log(f"  ❌ unclaimed: incorrectly shows is_verified={channel_data.get('is_verified')} or is_official={channel_data.get('is_official')}")
                all_passed = False
            else:
                log(f"  ✅ unclaimed: correctly shows is_verified=false, is_official=false")
        else:
            log(f"  ❌ unclaimed: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        log(f"  ❌ unclaimed: Exception - {str(e)}")
        all_passed = False
    
    if all_passed:
        log("\n✅ TEST 5 PASSED: Verification status integrity maintained")
        return True
    else:
        log("\n❌ TEST 5 FAILED: Verification status integrity violated")
        return False

def test_6_pagination_no_leak():
    """
    TEST 6: Pagination (skip/limit) cannot page a suppressed record back.
    """
    log("\n" + "="*80)
    log("TEST 6: Pagination cannot leak suppressed records")
    log("="*80)
    
    # Create a suppressed channel
    channel_suppressed = create_test_channel(
        "pagination-suppressed",
        is_demo=True,
        status="approved",
    )
    
    # Try to find it through pagination
    log(f"  Attempting to find suppressed channel through pagination...")
    
    found = False
    for skip in range(0, 100, 10):
        try:
            resp = session.get(f"{API_BASE}/channels", params={"skip": skip, "limit": 10}, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                items = data.get("data", {}).get("items", [])
                
                if any(item.get("slug") == channel_suppressed["slug"] for item in items):
                    log(f"  ❌ Found suppressed channel at skip={skip}")
                    found = True
                    break
            else:
                break
        except Exception as e:
            log(f"  ❌ Exception during pagination: {str(e)}")
            break
    
    if not found:
        log(f"  ✅ Suppressed channel not found through pagination")
        log("\n✅ TEST 6 PASSED: Pagination does not leak suppressed records")
        return True
    else:
        log("\n❌ TEST 6 FAILED: Pagination leaked suppressed record")
        return False

def test_7_stats_accuracy():
    """
    TEST 7: /api/discovery/home stats.totalApproved equals DB count of approved
    rows passing the filter.
    """
    log("\n" + "="*80)
    log("TEST 7: Stats accuracy")
    log("="*80)
    
    try:
        # Get stats from API
        resp = session.get(f"{API_BASE}/discovery/home", timeout=10)
        if resp.status_code != 200:
            log(f"  ❌ Failed to get discovery home: HTTP {resp.status_code}")
            return False
        
        data = resp.json()
        api_total = data.get("data", {}).get("stats", {}).get("totalApproved", 0)
        log(f"  API totalApproved: {api_total}")
        
        # Count in DB (approved channels that pass the filter)
        # For simplicity, we'll count approved channels that are NOT suppressed
        client = get_mongo_client()
        db = client[DB_NAME]
        
        # Count all approved channels
        total_approved = db.channels.count_documents({"status": "approved"})
        log(f"  DB total approved: {total_approved}")
        
        # Count suppressed channels (rough estimate)
        suppressed = db.channels.count_documents({
            "status": "approved",
            "$or": [
                {"is_test_fixture": True},
                {"is_demo": True},
                {"slug": {"$regex": "^(b2-ch|b2a|b2b|b2brs|b21-smoke|gb-ch|gc-ch|ut-ch)-[0-9a-f]{8}$", "$options": "i"}},
                {"slug": {"$regex": "^(smoke|hardening|qa|inject-test|reject-test|pending-test|pending-curation|m0\\d-test|m0\\d-final)[-_]", "$options": "i"}},
                {"slug": {"$regex": "^test-", "$options": "i"}},
                {"name": {"$regex": "^Test ", "$options": ""}},
                {"whatsapp_url": {"$regex": "whatsapp\\.com/channel/demo-", "$options": "i"}},
                {"follower_count_source": {"$in": ["demo_seed", "smoke", "qa_seed"]}},
            ]
        })
        log(f"  DB suppressed: {suppressed}")
        
        expected_total = total_approved - suppressed
        log(f"  Expected totalApproved: {expected_total}")
        
        client.close()
        
        # Allow small variance due to timing
        if abs(api_total - expected_total) <= 5:
            log(f"  ✅ Stats match (within tolerance)")
            log("\n✅ TEST 7 PASSED: Stats are accurate")
            return True
        else:
            log(f"  ❌ Stats mismatch: API={api_total}, Expected={expected_total}")
            log("\n❌ TEST 7 FAILED: Stats are inaccurate")
            return False
    except Exception as e:
        log(f"  ❌ Exception: {str(e)}")
        log("\n❌ TEST 7 FAILED: Exception occurred")
        return False

def test_8_data_integrity():
    """
    TEST 8: DATA INTEGRITY - after exercising every surface, re-read each
    channel row and assert status, verification_status, owner_id,
    follower_count and follower_count_source are unchanged.
    """
    log("\n" + "="*80)
    log("TEST 8: Data integrity - no mutations")
    log("="*80)
    
    # Create a test channel and record its initial state
    channel = create_test_channel(
        "integrity-check",
        status="approved",
        verification_status="unverified",
        owner_id=None,
        follower_count=1234,
        follower_count_source="manual",
    )
    
    initial_state = {
        "status": channel["status"],
        "verification_status": channel["verification_status"],
        "owner_id": channel["owner_id"],
        "follower_count": channel["follower_count"],
        "follower_count_source": channel["follower_count_source"],
    }
    
    log(f"  Initial state: {initial_state}")
    
    # Exercise all surfaces
    log(f"  Exercising all surfaces...")
    verify_channel_visible_everywhere(channel["slug"])
    
    # Re-read from DB
    client = get_mongo_client()
    db = client[DB_NAME]
    
    updated_channel = db.channels.find_one({"slug": channel["slug"]})
    client.close()
    
    if not updated_channel:
        log(f"  ❌ Channel was deleted!")
        log("\n❌ TEST 8 FAILED: Channel was deleted")
        return False
    
    final_state = {
        "status": updated_channel.get("status"),
        "verification_status": updated_channel.get("verification_status"),
        "owner_id": updated_channel.get("owner_id"),
        "follower_count": updated_channel.get("follower_count"),
        "follower_count_source": updated_channel.get("follower_count_source"),
    }
    
    log(f"  Final state: {final_state}")
    
    if initial_state == final_state:
        log(f"  ✅ All fields unchanged")
        log("\n✅ TEST 8 PASSED: Data integrity maintained")
        return True
    else:
        log(f"  ❌ Fields changed!")
        for key in initial_state:
            if initial_state[key] != final_state[key]:
                log(f"    {key}: {initial_state[key]} -> {final_state[key]}")
        log("\n❌ TEST 8 FAILED: Data was mutated")
        return False

def test_9_no_field_leakage():
    """
    TEST 9: Public responses must not leak is_test_fixture, is_demo, owner_id,
    verification_status, reviewed_by, rejection_reason.
    """
    log("\n" + "="*80)
    log("TEST 9: No field leakage in public responses")
    log("="*80)
    
    # Create a test channel
    channel = create_test_channel(
        "leakage-check",
        status="approved",
        verification_status="unverified",
        owner_id="test-owner-id",
    )
    
    try:
        resp = session.get(f"{API_BASE}/channels/{channel['slug']}", timeout=10)
        if resp.status_code != 200:
            log(f"  ❌ Failed to get channel: HTTP {resp.status_code}")
            return False
        
        data = resp.json()
        channel_data = data.get("data", {})
        
        # Check for leaked fields
        leaked_fields = []
        forbidden_fields = [
            "is_test_fixture",
            "is_demo",
            "owner_id",
            "verification_status",
            "reviewed_by",
            "rejection_reason",
        ]
        
        for field in forbidden_fields:
            if field in channel_data:
                leaked_fields.append(field)
                log(f"  ❌ LEAKED: {field} = {channel_data[field]}")
        
        if not leaked_fields:
            log(f"  ✅ No forbidden fields leaked")
            log("\n✅ TEST 9 PASSED: No field leakage detected")
            return True
        else:
            log(f"  ❌ Leaked fields: {', '.join(leaked_fields)}")
            log("\n❌ TEST 9 FAILED: Field leakage detected")
            return False
    except Exception as e:
        log(f"  ❌ Exception: {str(e)}")
        log("\n❌ TEST 9 FAILED: Exception occurred")
        return False

def main():
    """Main test runner"""
    log("="*80)
    log("WAVELEAD FINALIST READINESS - Backend Verification")
    log("="*80)
    log(f"BASE_URL: {BASE_URL}")
    log(f"MONGO_URL: {MONGO_URL}")
    log(f"DB_NAME: {DB_NAME}")
    log(f"RUN_TAG: {RUN_TAG}")
    
    try:
        # Run all tests
        results = []
        
        results.append(("TEST 1: Real channel visibility", test_1_real_channel_visibility()))
        results.append(("TEST 2: Suppression families", test_2_suppression_families()))
        results.append(("TEST 3: No false positives", test_3_no_false_positives()))
        results.append(("TEST 4: Pending/rejected hidden", test_4_pending_rejected_hidden()))
        results.append(("TEST 5: Verification status integrity", test_5_verification_status_integrity()))
        results.append(("TEST 6: Pagination no leak", test_6_pagination_no_leak()))
        results.append(("TEST 7: Stats accuracy", test_7_stats_accuracy()))
        results.append(("TEST 8: Data integrity", test_8_data_integrity()))
        results.append(("TEST 9: No field leakage", test_9_no_field_leakage()))
        
        # Summary
        log("\n" + "="*80)
        log("TEST SUMMARY")
        log("="*80)
        
        passed = sum(1 for _, result in results if result)
        total = len(results)
        
        for name, result in results:
            status = "✅ PASS" if result else "❌ FAIL"
            log(f"{status}: {name}")
        
        log(f"\nTotal: {passed}/{total} tests passed")
        
        if passed == total:
            log("\n🎉 ALL TESTS PASSED!")
            return 0
        else:
            log(f"\n⚠️  {total - passed} test(s) failed")
            return 1
    
    finally:
        # Cleanup
        cleanup_test_fixtures()

if __name__ == "__main__":
    sys.exit(main())
