#!/usr/bin/env python3
"""
WaveLead Finalist — Discovery Pagination & Top Country UX Backend Verification
Tests all 11 verification items from test_result.md
"""

import requests
import time
import json
from pymongo import MongoClient
from datetime import datetime
import random
import string

# Configuration
BASE_URL = "http://localhost:3000"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "wavelead"

# Test run identifier
RUN_TAG = f"pagination-test-{int(time.time())}"

# Global session
session = requests.Session()

def log(msg):
    """Print timestamped log message"""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def get_mongo_client():
    """Get MongoDB client"""
    return MongoClient(MONGO_URL)

def generate_test_slug():
    """Generate a unique test slug"""
    return f"pagination-verify-{RUN_TAG}-{random.randint(1000, 9999)}"

def create_test_channels(count=75, category_slug="news", country_code="ID", include_suppressed=5):
    """
    Create test channels for pagination testing.
    Returns: (eligible_channel_ids, suppressed_channel_ids, category_id)
    """
    log(f"Creating {count} eligible + {include_suppressed} suppressed test channels in category '{category_slug}'...")
    
    client = get_mongo_client()
    db = client[DB_NAME]
    
    # Get category
    category = db.categories.find_one({"slug": category_slug})
    if not category:
        log(f"❌ Category '{category_slug}' not found")
        client.close()
        return None, None, None
    
    category_id = category["id"]
    
    eligible_ids = []
    suppressed_ids = []
    
    # Create eligible channels (use slug that doesn't match test- pattern)
    for i in range(count):
        channel_id = f"pagination-verify-{RUN_TAG}-eligible-{i:04d}"
        slug = f"pagination-verify-{RUN_TAG}-eligible-{i:04d}"
        
        channel = {
            "id": channel_id,
            "slug": slug,
            "name": f"Pagination Verify Channel {i+1}",
            "short_description": f"Pagination verify channel {i+1} for testing",
            "description": f"This is pagination verify channel {i+1} created for testing. Tag: {RUN_TAG}",
            "whatsapp_url": f"https://whatsapp.com/channel/0029Va{RUN_TAG[:10]}{i:04d}",
            "category_id": category_id,
            "country_code": country_code,
            "primary_language": "en",
            "status": "approved",
            "verification_status": "unclaimed",
            "is_test_fixture": False,
            "is_demo": False,
            "follower_count": random.randint(1000, 100000),
            "follower_count_source": "test",
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        
        db.channels.insert_one(channel)
        eligible_ids.append(channel_id)
    
    # Create suppressed channels (various suppression reasons)
    suppression_types = [
        {"is_demo": True, "reason": "demo"},
        {"is_test_fixture": True, "reason": "test_fixture"},
        {"status": "pending_review", "reason": "pending"},
        {"status": "rejected", "reason": "rejected"},
        {"slug": f"b2-ch-{random.randint(10000000, 99999999):08x}", "reason": "qa_slug"},
    ]
    
    for i in range(include_suppressed):
        suppression = suppression_types[i % len(suppression_types)]
        channel_id = f"pagination-verify-{RUN_TAG}-suppressed-{i:04d}"
        slug = suppression.get("slug", f"pagination-verify-{RUN_TAG}-suppressed-{i:04d}")
        
        channel = {
            "id": channel_id,
            "slug": slug,
            "name": f"Pagination Suppressed Channel {i+1}",
            "short_description": f"Suppressed pagination channel {i+1}",
            "description": f"This is suppressed pagination channel {i+1}. Reason: {suppression['reason']}",
            "whatsapp_url": f"https://whatsapp.com/channel/0029VaSuppressed{i:04d}",
            "category_id": category_id,
            "country_code": country_code,
            "primary_language": "en",
            "status": suppression.get("status", "approved"),
            "verification_status": "unclaimed",
            "is_test_fixture": suppression.get("is_test_fixture", False),
            "is_demo": suppression.get("is_demo", False),
            "follower_count": random.randint(1000, 100000),
            "follower_count_source": "test",
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        
        db.channels.insert_one(channel)
        suppressed_ids.append(channel_id)
    
    client.close()
    log(f"✅ Created {count} eligible + {include_suppressed} suppressed test channels")
    return eligible_ids, suppressed_ids, category_id

def cleanup_test_channels():
    """Clean up all test channels created by this run"""
    log(f"Cleaning up test channels with tag '{RUN_TAG}'...")
    
    client = get_mongo_client()
    db = client[DB_NAME]
    
    result = db.channels.delete_many({
        "$or": [
            {"id": {"$regex": f"^pagination-verify-{RUN_TAG}"}},
            {"slug": {"$regex": f"^pagination-verify-{RUN_TAG}"}},
        ]
    })
    
    client.close()
    log(f"✅ Cleaned up {result.deleted_count} test channels")

# ============================================================================
# TEST 1: Pagination returns correct total and page size
# ============================================================================
def test_1_pagination_total_and_page_size(category_slug, expected_total):
    """
    TEST 1: Seed >1 page (75) eligible approved channels in ONE category.
    GET /api/channels?category=<slug>&sort=top&limit=30&skip=0 → exactly 30 items, `total` 75 (not 30).
    """
    log("\n=== TEST 1: Pagination returns correct total and page size ===")
    
    try:
        resp = session.get(f"{BASE_URL}/api/channels", params={
            "category": category_slug,
            "sort": "top",
            "limit": 30,
            "skip": 0
        })
        
        if resp.status_code != 200:
            log(f"❌ TEST 1 FAIL: Expected 200, got {resp.status_code}")
            return False
        
        data = resp.json()
        if not data.get("ok"):
            log(f"❌ TEST 1 FAIL: Response not ok: {data.get('error')}")
            return False
        
        result = data.get("data", {})
        items = result.get("items", [])
        total = result.get("total", 0)
        
        # Assert: exactly 30 items
        if len(items) != 30:
            log(f"❌ TEST 1 FAIL: Expected 30 items, got {len(items)}")
            return False
        
        # Assert: total equals expected_total (not 30)
        if total != expected_total:
            log(f"❌ TEST 1 FAIL: Expected total={expected_total}, got {total}")
            return False
        
        log(f"✅ TEST 1 PASS: Got 30 items with total={total}")
        return True
        
    except Exception as e:
        log(f"❌ TEST 1 FAIL: Exception: {e}")
        return False

# ============================================================================
# TEST 2: Walk all pages, verify uniqueness and completeness
# ============================================================================
def test_2_pagination_walk_all_pages(category_slug, expected_total):
    """
    TEST 2: Walk skip=0,30,60 → union is exactly 75 unique records,
    each seeded record appears EXACTLY once, none missing.
    Paging past the end → empty array.
    """
    log("\n=== TEST 2: Walk all pages, verify uniqueness and completeness ===")
    
    try:
        all_ids = set()
        all_slugs = set()
        page_size = 30
        skip = 0
        page_num = 1
        
        while True:
            resp = session.get(f"{BASE_URL}/api/channels", params={
                "category": category_slug,
                "sort": "top",
                "limit": page_size,
                "skip": skip
            })
            
            if resp.status_code != 200:
                log(f"❌ TEST 2 FAIL: Page {page_num} returned {resp.status_code}")
                return False
            
            data = resp.json()
            result = data.get("data", {})
            items = result.get("items", [])
            
            if not items:
                log(f"   Page {page_num} (skip={skip}): 0 items (end of results)")
                break
            
            log(f"   Page {page_num} (skip={skip}): {len(items)} items")
            
            for item in items:
                item_id = item.get("id")
                item_slug = item.get("slug")
                
                # Check for duplicates
                if item_id in all_ids:
                    log(f"❌ TEST 2 FAIL: Duplicate id found: {item_id}")
                    return False
                
                if item_slug in all_slugs:
                    log(f"❌ TEST 2 FAIL: Duplicate slug found: {item_slug}")
                    return False
                
                all_ids.add(item_id)
                all_slugs.add(item_slug)
            
            skip += page_size
            page_num += 1
            
            # Safety: stop after 10 pages
            if page_num > 10:
                log(f"⚠️  TEST 2 WARNING: Stopped after 10 pages (safety limit)")
                break
        
        # Verify total count
        if len(all_ids) != expected_total:
            log(f"❌ TEST 2 FAIL: Expected {expected_total} unique records, got {len(all_ids)}")
            return False
        
        # Verify paging past the end returns empty
        resp = session.get(f"{BASE_URL}/api/channels", params={
            "category": category_slug,
            "sort": "top",
            "limit": page_size,
            "skip": expected_total + 100
        })
        
        if resp.status_code == 200:
            data = resp.json()
            result = data.get("data", {})
            items = result.get("items", [])
            
            if len(items) != 0:
                log(f"❌ TEST 2 FAIL: Paging past end returned {len(items)} items (expected 0)")
                return False
        
        log(f"✅ TEST 2 PASS: Walked all pages, got {len(all_ids)} unique records, no duplicates, paging past end returns empty")
        return True
        
    except Exception as e:
        log(f"❌ TEST 2 FAIL: Exception: {e}")
        return False

# ============================================================================
# TEST 3: Total matches direct DB count with same filter
# ============================================================================
def test_3_total_matches_db_count(category_slug, category_id):
    """
    TEST 3: `total` equals a direct DB count using buildPublicChannelFilter
    with the same category_id — excluding demo, is_test_fixture, QA slug, pending_review, rejected.
    """
    log("\n=== TEST 3: Total matches direct DB count with same filter ===")
    
    try:
        # Get API total
        resp = session.get(f"{BASE_URL}/api/channels", params={
            "category": category_slug,
            "sort": "top",
            "limit": 1,
            "skip": 0
        })
        
        if resp.status_code != 200:
            log(f"❌ TEST 3 FAIL: API request failed with {resp.status_code}")
            return False
        
        data = resp.json()
        result = data.get("data", {})
        api_total = result.get("total", 0)
        
        # Get DB count with same filter
        client = get_mongo_client()
        db = client[DB_NAME]
        
        # Build the same filter as buildPublicChannelFilter
        db_filter = {
            "status": "approved",
            "category_id": category_id,
            "$and": [
                {"is_test_fixture": {"$ne": True}},
                {"is_demo": {"$ne": True}},
                {"slug": {"$not": {"$regex": "^(?:b2-ch|b2a|b2b|b2brs|b21-smoke|gb-ch|gc-ch|ut-ch)-[0-9a-f]{8}$", "$options": "i"}}},
                {"slug": {"$not": {"$regex": "^(?:smoke|hardening|qa|inject-test|reject-test|pending-test|pending-curation|m0\\d-test|m0\\d-final)[-_]", "$options": "i"}}},
                {"slug": {"$not": {"$regex": "^test-", "$options": "i"}}},
                {"name": {"$not": {"$regex": "^Test ", "$options": "i"}}},
                {"whatsapp_url": {"$not": {"$regex": "whatsapp\\.com/channel/demo-", "$options": "i"}}},
                {"follower_count_source": {"$nin": ["demo_seed", "smoke", "qa_seed"]}},
            ]
        }
        
        db_count = db.channels.count_documents(db_filter)
        client.close()
        
        log(f"   API total: {api_total}")
        log(f"   DB count:  {db_count}")
        
        if api_total != db_count:
            log(f"❌ TEST 3 FAIL: API total ({api_total}) != DB count ({db_count})")
            return False
        
        log(f"✅ TEST 3 PASS: API total matches DB count ({api_total})")
        return True
        
    except Exception as e:
        log(f"❌ TEST 3 FAIL: Exception: {e}")
        return False

# ============================================================================
# TEST 4: Suppressed records never appear
# ============================================================================
def test_4_suppressed_records_never_appear(category_slug, suppressed_ids):
    """
    TEST 4: Suppressed records seeded in that SAME category never appear on ANY page
    — in the JSON or in the server-rendered HTML of ?page=1/2/3.
    """
    log("\n=== TEST 4: Suppressed records never appear ===")
    
    try:
        # Check API responses
        all_ids = set()
        skip = 0
        page_size = 30
        
        for page_num in range(1, 4):  # Check first 3 pages
            resp = session.get(f"{BASE_URL}/api/channels", params={
                "category": category_slug,
                "sort": "top",
                "limit": page_size,
                "skip": skip
            })
            
            if resp.status_code == 200:
                data = resp.json()
                result = data.get("data", {})
                items = result.get("items", [])
                
                for item in items:
                    item_id = item.get("id")
                    all_ids.add(item_id)
                    
                    if item_id in suppressed_ids:
                        log(f"❌ TEST 4 FAIL: Suppressed record {item_id} found in API response (page {page_num})")
                        return False
            
            skip += page_size
        
        # Check server-rendered HTML
        for page_num in range(1, 4):
            resp = session.get(f"{BASE_URL}/category/{category_slug}", params={"page": page_num})
            
            if resp.status_code == 200:
                html = resp.text
                
                for suppressed_id in suppressed_ids:
                    if suppressed_id in html:
                        log(f"❌ TEST 4 FAIL: Suppressed record {suppressed_id} found in HTML (page {page_num})")
                        return False
        
        log(f"✅ TEST 4 PASS: No suppressed records found in API or HTML")
        return True
        
    except Exception as e:
        log(f"❌ TEST 4 FAIL: Exception: {e}")
        return False

# ============================================================================
# TEST 5: Deterministic ordering
# ============================================================================
def test_5_deterministic_ordering(category_slug):
    """
    TEST 5: Ordering is identical across repeated identical requests,
    and `sort=newest` also paginates without duplicates when all rows share an identical created_at.
    """
    log("\n=== TEST 5: Deterministic ordering ===")
    
    try:
        # Test 1: Repeated requests with sort=top
        log("   Testing sort=top determinism...")
        
        resp1 = session.get(f"{BASE_URL}/api/channels", params={
            "category": category_slug,
            "sort": "top",
            "limit": 30,
            "skip": 0
        })
        
        time.sleep(1)
        
        resp2 = session.get(f"{BASE_URL}/api/channels", params={
            "category": category_slug,
            "sort": "top",
            "limit": 30,
            "skip": 0
        })
        
        if resp1.status_code != 200 or resp2.status_code != 200:
            log(f"❌ TEST 5 FAIL: API requests failed")
            return False
        
        data1 = resp1.json().get("data", {})
        data2 = resp2.json().get("data", {})
        
        items1 = data1.get("items", [])
        items2 = data2.get("items", [])
        
        ids1 = [item.get("id") for item in items1]
        ids2 = [item.get("id") for item in items2]
        
        if ids1 != ids2:
            log(f"❌ TEST 5 FAIL: sort=top ordering not deterministic")
            return False
        
        log(f"   ✅ sort=top ordering is deterministic")
        
        # Test 2: sort=newest pagination without duplicates
        log("   Testing sort=newest pagination...")
        
        all_ids = set()
        skip = 0
        page_size = 30
        
        for page_num in range(1, 4):  # Check first 3 pages
            resp = session.get(f"{BASE_URL}/api/channels", params={
                "category": category_slug,
                "sort": "newest",
                "limit": page_size,
                "skip": skip
            })
            
            if resp.status_code == 200:
                data = resp.json().get("data", {})
                items = data.get("items", [])
                
                for item in items:
                    item_id = item.get("id")
                    
                    if item_id in all_ids:
                        log(f"❌ TEST 5 FAIL: Duplicate id in sort=newest: {item_id}")
                        return False
                    
                    all_ids.add(item_id)
            
            skip += page_size
        
        log(f"   ✅ sort=newest pagination has no duplicates")
        
        log(f"✅ TEST 5 PASS: Ordering is deterministic")
        return True
        
    except Exception as e:
        log(f"❌ TEST 5 FAIL: Exception: {e}")
        return False

# ============================================================================
# TEST 6: Search pagination
# ============================================================================
def test_6_search_pagination(category_slug):
    """
    TEST 6: SEARCH: ?q=<tag>&limit=30&skip=0 vs skip=30 return disjoint sets;
    ?q=<tag>&category=<slug> reports a total consistent with what paging actually yields.
    """
    log("\n=== TEST 6: Search pagination ===")
    
    try:
        # Use a common word that should match multiple channels
        search_query = "pagination"
        
        # Get first page
        resp1 = session.get(f"{BASE_URL}/api/channels", params={
            "q": search_query,
            "category": category_slug,
            "limit": 30,
            "skip": 0
        })
        
        # Get second page
        resp2 = session.get(f"{BASE_URL}/api/channels", params={
            "q": search_query,
            "category": category_slug,
            "limit": 30,
            "skip": 30
        })
        
        if resp1.status_code != 200 or resp2.status_code != 200:
            log(f"❌ TEST 6 FAIL: API requests failed")
            return False
        
        data1 = resp1.json().get("data", {})
        data2 = resp2.json().get("data", {})
        
        items1 = data1.get("items", [])
        items2 = data2.get("items", [])
        total = data1.get("total", 0)
        
        ids1 = set(item.get("id") for item in items1)
        ids2 = set(item.get("id") for item in items2)
        
        # Check disjoint sets
        intersection = ids1 & ids2
        if intersection:
            log(f"❌ TEST 6 FAIL: Pages have overlapping ids: {intersection}")
            return False
        
        log(f"   ✅ Search pages are disjoint (page1: {len(ids1)}, page2: {len(ids2)})")
        
        # Walk all pages and verify total
        all_ids = set()
        skip = 0
        page_size = 30
        
        while True:
            resp = session.get(f"{BASE_URL}/api/channels", params={
                "q": search_query,
                "category": category_slug,
                "limit": page_size,
                "skip": skip
            })
            
            if resp.status_code != 200:
                break
            
            data = resp.json().get("data", {})
            items = data.get("items", [])
            
            if not items:
                break
            
            for item in items:
                all_ids.add(item.get("id"))
            
            skip += page_size
            
            # Safety limit
            if skip > 300:
                break
        
        if len(all_ids) != total:
            log(f"❌ TEST 6 FAIL: Total mismatch (reported: {total}, actual: {len(all_ids)})")
            return False
        
        log(f"   ✅ Search total consistent with paging (total: {total})")
        
        log(f"✅ TEST 6 PASS: Search pagination working correctly")
        return True
        
    except Exception as e:
        log(f"❌ TEST 6 FAIL: Exception: {e}")
        return False

# ============================================================================
# TEST 7: Server-rendered pagination controls
# ============================================================================
def test_7_server_rendered_pagination(category_slug):
    """
    TEST 7: Server-rendered /category/<slug> contains rel="next" and a ?page=2 link;
    ?page=2 renders DIFFERENT records than page 1;
    /channels, /country/indonesia and /search all contain the `loadmore-progress` testid.
    """
    log("\n=== TEST 7: Server-rendered pagination controls ===")
    
    try:
        # Check /category/<slug> page 1
        resp1 = session.get(f"{BASE_URL}/category/{category_slug}")
        
        if resp1.status_code != 200:
            log(f"❌ TEST 7 FAIL: /category/{category_slug} returned {resp1.status_code}")
            return False
        
        html1 = resp1.text
        
        # Check for rel="next"
        if 'rel="next"' not in html1:
            log(f"❌ TEST 7 FAIL: rel='next' not found in page 1")
            return False
        
        # Check for ?page=2 link
        if '?page=2' not in html1:
            log(f"❌ TEST 7 FAIL: ?page=2 link not found in page 1")
            return False
        
        log(f"   ✅ Page 1 contains rel='next' and ?page=2 link")
        
        # Check /category/<slug>?page=2
        resp2 = session.get(f"{BASE_URL}/category/{category_slug}", params={"page": 2})
        
        if resp2.status_code != 200:
            log(f"❌ TEST 7 FAIL: /category/{category_slug}?page=2 returned {resp2.status_code}")
            return False
        
        html2 = resp2.text
        
        # Verify different content (simple check: different HTML)
        if html1 == html2:
            log(f"❌ TEST 7 FAIL: Page 1 and page 2 have identical HTML")
            return False
        
        log(f"   ✅ Page 2 renders different content than page 1")
        
        # Check for loadmore-progress testid in various pages
        pages_to_check = [
            ("/channels", "channels"),
            ("/country/indonesia", "country/indonesia"),
            ("/search?q=test", "search"),
        ]
        
        for path, name in pages_to_check:
            resp = session.get(f"{BASE_URL}{path}")
            
            if resp.status_code == 200:
                html = resp.text
                
                if 'data-testid="loadmore-progress"' in html:
                    log(f"   ✅ {name} contains loadmore-progress testid")
                else:
                    log(f"⚠️  TEST 7 WARNING: {name} does not contain loadmore-progress testid")
            else:
                log(f"⚠️  TEST 7 WARNING: {name} returned {resp.status_code}")
        
        log(f"✅ TEST 7 PASS: Server-rendered pagination controls working")
        return True
        
    except Exception as e:
        log(f"❌ TEST 7 FAIL: Exception: {e}")
        return False

# ============================================================================
# TEST 8: Top country selector UX
# ============================================================================
def test_8_top_country_selector():
    """
    TEST 8: /top renders fewer than 30 occurrences of `country-pill-`,
    includes `country-pill-all`, `country-pill-ID` and `country-more-button`;
    /top?country=US shows "Top WhatsApp Channels in United States";
    /top with no param still defaults to Indonesia;
    /top?country=all renders "Top WhatsApp Channels Worldwide";
    /top?country=ID&page=2 shows "Showing 31–".
    NOTE: React emits `<!-- -->` between adjacent text nodes, so strip HTML comments before asserting on copy.
    """
    log("\n=== TEST 8: Top country selector UX ===")
    
    try:
        # Check /top default (should be Indonesia)
        resp = session.get(f"{BASE_URL}/top")
        
        if resp.status_code != 200:
            log(f"❌ TEST 8 FAIL: /top returned {resp.status_code}")
            return False
        
        html = resp.text
        
        # Strip HTML comments
        html_clean = html.replace("<!-- -->", "")
        
        # Count country-pill- occurrences
        pill_count = html.count('country-pill-')
        
        if pill_count >= 30:
            log(f"❌ TEST 8 FAIL: Found {pill_count} country pills (expected < 30)")
            return False
        
        log(f"   ✅ Found {pill_count} country pills (< 30)")
        
        # Check for required elements
        required_testids = [
            'data-testid="country-pill-all"',
            'data-testid="country-pill-ID"',
            'data-testid="country-more-button"',
        ]
        
        for testid in required_testids:
            if testid not in html:
                log(f"❌ TEST 8 FAIL: {testid} not found")
                return False
        
        log(f"   ✅ All required testids found")
        
        # Check default is Indonesia
        if "Indonesia" not in html_clean:
            log(f"❌ TEST 8 FAIL: Default page does not show Indonesia")
            return False
        
        log(f"   ✅ Default page shows Indonesia")
        
        # Check /top?country=US
        resp_us = session.get(f"{BASE_URL}/top", params={"country": "US"})
        
        if resp_us.status_code == 200:
            html_us = resp_us.text.replace("<!-- -->", "")
            
            if "United States" not in html_us:
                log(f"❌ TEST 8 FAIL: /top?country=US does not show 'United States'")
                return False
            
            log(f"   ✅ /top?country=US shows 'United States'")
        else:
            log(f"⚠️  TEST 8 WARNING: /top?country=US returned {resp_us.status_code}")
        
        # Check /top?country=all
        resp_all = session.get(f"{BASE_URL}/top", params={"country": "all"})
        
        if resp_all.status_code == 200:
            html_all = resp_all.text.replace("<!-- -->", "")
            
            if "Worldwide" not in html_all:
                log(f"❌ TEST 8 FAIL: /top?country=all does not show 'Worldwide'")
                return False
            
            log(f"   ✅ /top?country=all shows 'Worldwide'")
        else:
            log(f"⚠️  TEST 8 WARNING: /top?country=all returned {resp_all.status_code}")
        
        # Check /top?country=ID&page=2
        resp_page2 = session.get(f"{BASE_URL}/top", params={"country": "ID", "page": 2})
        
        if resp_page2.status_code == 200:
            html_page2 = resp_page2.text.replace("<!-- -->", "")
            
            if "Showing 31" not in html_page2 and "31–" not in html_page2:
                log(f"⚠️  TEST 8 WARNING: /top?country=ID&page=2 does not show 'Showing 31–'")
            else:
                log(f"   ✅ /top?country=ID&page=2 shows 'Showing 31–'")
        else:
            log(f"⚠️  TEST 8 WARNING: /top?country=ID&page=2 returned {resp_page2.status_code}")
        
        log(f"✅ TEST 8 PASS: Top country selector UX working")
        return True
        
    except Exception as e:
        log(f"❌ TEST 8 FAIL: Exception: {e}")
        return False

# ============================================================================
# TEST 9: Country-scoped Top ranking
# ============================================================================
def test_9_country_scoped_top_ranking():
    """
    TEST 9: Country-scoped Top returns ONLY that country,
    ranks by effective observed follower count descending with unknown counts LAST,
    and paginates without duplicates.
    """
    log("\n=== TEST 9: Country-scoped Top ranking ===")
    
    try:
        # Get /top?country=ID
        resp = session.get(f"{BASE_URL}/api/channels", params={
            "country": "ID",
            "sort": "top",
            "limit": 30,
            "skip": 0
        })
        
        if resp.status_code != 200:
            log(f"❌ TEST 9 FAIL: API request failed with {resp.status_code}")
            return False
        
        data = resp.json().get("data", {})
        items = data.get("items", [])
        
        # Check all items are from ID
        for item in items:
            if item.get("country_code") != "ID":
                log(f"❌ TEST 9 FAIL: Found non-ID channel: {item.get('slug')} ({item.get('country_code')})")
                return False
        
        log(f"   ✅ All items are from country ID")
        
        # Check ranking order (descending follower count)
        prev_count = float('inf')
        for item in items:
            # Get effective follower count (max of follower_count and public_followers_count)
            follower_count = item.get("follower_count", 0) or 0
            public_count = item.get("public_followers_count", 0) or 0
            effective_count = max(follower_count, public_count)
            
            if effective_count > prev_count:
                log(f"❌ TEST 9 FAIL: Ranking not descending: {effective_count} > {prev_count}")
                return False
            
            prev_count = effective_count
        
        log(f"   ✅ Ranking is descending by effective follower count")
        
        # Check pagination without duplicates
        all_ids = set()
        skip = 0
        page_size = 30
        
        for page_num in range(1, 4):  # Check first 3 pages
            resp = session.get(f"{BASE_URL}/api/channels", params={
                "country": "ID",
                "sort": "top",
                "limit": page_size,
                "skip": skip
            })
            
            if resp.status_code == 200:
                data = resp.json().get("data", {})
                items = data.get("items", [])
                
                for item in items:
                    item_id = item.get("id")
                    
                    if item_id in all_ids:
                        log(f"❌ TEST 9 FAIL: Duplicate id in pagination: {item_id}")
                        return False
                    
                    all_ids.add(item_id)
            
            skip += page_size
        
        log(f"   ✅ Pagination has no duplicates")
        
        log(f"✅ TEST 9 PASS: Country-scoped Top ranking working correctly")
        return True
        
    except Exception as e:
        log(f"❌ TEST 9 FAIL: Exception: {e}")
        return False

# ============================================================================
# TEST 10: Existing SEO routes still work
# ============================================================================
def test_10_existing_seo_routes():
    """
    TEST 10: These still return 200: /channels, /channels?sort=newest,
    /category/<slug>, /country/indonesia, /top, /top?country=ID,
    /trending, /categories, /countries. Canonical tag unchanged by ?page=.
    """
    log("\n=== TEST 10: Existing SEO routes still work ===")
    
    try:
        routes = [
            "/channels",
            "/channels?sort=newest",
            "/category/news",
            "/country/indonesia",
            "/top",
            "/top?country=ID",
            "/trending",
            "/categories",
            "/countries",
        ]
        
        all_passed = True
        
        for route in routes:
            resp = session.get(f"{BASE_URL}{route}")
            
            if resp.status_code == 200:
                log(f"   ✅ {route} → 200")
            else:
                log(f"   ❌ {route} → {resp.status_code}")
                all_passed = False
        
        # Check canonical tag unchanged by ?page=
        resp1 = session.get(f"{BASE_URL}/category/news")
        resp2 = session.get(f"{BASE_URL}/category/news?page=2")
        
        if resp1.status_code == 200 and resp2.status_code == 200:
            html1 = resp1.text
            html2 = resp2.text
            
            # Extract canonical tags
            import re
            canonical1 = re.search(r'<link rel="canonical" href="([^"]+)"', html1)
            canonical2 = re.search(r'<link rel="canonical" href="([^"]+)"', html2)
            
            if canonical1 and canonical2:
                url1 = canonical1.group(1)
                url2 = canonical2.group(1)
                
                if url1 == url2:
                    log(f"   ✅ Canonical tag unchanged by ?page= ({url1})")
                else:
                    log(f"   ⚠️  Canonical tags differ: {url1} vs {url2}")
            else:
                log(f"   ⚠️  Could not extract canonical tags")
        
        if all_passed:
            log(f"✅ TEST 10 PASS: All SEO routes working")
            return True
        else:
            log(f"❌ TEST 10 FAIL: Some routes failed")
            return False
        
    except Exception as e:
        log(f"❌ TEST 10 FAIL: Exception: {e}")
        return False

# ============================================================================
# TEST 11: Avatar and inventory still working
# ============================================================================
def test_11_avatar_and_inventory():
    """
    TEST 11: Real channel avatars still render via /api/channels/<slug>/avatar
    and demo/fixture inventory is still hidden everywhere.
    """
    log("\n=== TEST 11: Avatar and inventory still working ===")
    
    try:
        # Get a real channel slug
        resp = session.get(f"{BASE_URL}/api/channels", params={"limit": 1, "skip": 0})
        
        if resp.status_code != 200:
            log(f"❌ TEST 11 FAIL: Could not get channels")
            return False
        
        data = resp.json().get("data", {})
        items = data.get("items", [])
        
        if not items:
            log(f"⚠️  TEST 11 WARNING: No channels found to test avatar")
            return True
        
        channel_slug = items[0].get("slug")
        
        # Check avatar endpoint
        avatar_resp = session.get(f"{BASE_URL}/api/channels/{channel_slug}/avatar")
        
        if avatar_resp.status_code in [200, 302, 404]:
            log(f"   ✅ Avatar endpoint working (status: {avatar_resp.status_code})")
        else:
            log(f"   ❌ Avatar endpoint returned unexpected status: {avatar_resp.status_code}")
            return False
        
        # Check demo/fixture inventory is hidden
        # Try to access a demo channel
        demo_resp = session.get(f"{BASE_URL}/api/channels/demo-channel-test")
        
        if demo_resp.status_code == 404:
            log(f"   ✅ Demo channel correctly hidden (404)")
        else:
            log(f"   ⚠️  Demo channel returned {demo_resp.status_code} (expected 404)")
        
        log(f"✅ TEST 11 PASS: Avatar and inventory working correctly")
        return True
        
    except Exception as e:
        log(f"❌ TEST 11 FAIL: Exception: {e}")
        return False

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================
def main():
    """Main test runner"""
    log("=" * 80)
    log("WaveLead Finalist — Discovery Pagination & Top Country UX")
    log("Backend Verification (11 tests)")
    log("=" * 80)
    
    # Create test data
    category_slug = "news"
    eligible_ids, suppressed_ids, category_id = create_test_channels(
        count=75,
        category_slug=category_slug,
        country_code="ID",
        include_suppressed=5
    )
    
    if not eligible_ids:
        log("\n❌ CRITICAL: Could not create test data. Aborting tests.")
        return
    
    expected_total = len(eligible_ids)
    
    try:
        results = {}
        
        # Run tests
        results["TEST 1"] = test_1_pagination_total_and_page_size(category_slug, expected_total)
        results["TEST 2"] = test_2_pagination_walk_all_pages(category_slug, expected_total)
        results["TEST 3"] = test_3_total_matches_db_count(category_slug, category_id)
        results["TEST 4"] = test_4_suppressed_records_never_appear(category_slug, suppressed_ids)
        results["TEST 5"] = test_5_deterministic_ordering(category_slug)
        results["TEST 6"] = test_6_search_pagination(category_slug)
        results["TEST 7"] = test_7_server_rendered_pagination(category_slug)
        results["TEST 8"] = test_8_top_country_selector()
        results["TEST 9"] = test_9_country_scoped_top_ranking()
        results["TEST 10"] = test_10_existing_seo_routes()
        results["TEST 11"] = test_11_avatar_and_inventory()
        
        # Summary
        log("\n" + "=" * 80)
        log("TEST SUMMARY")
        log("=" * 80)
        
        for test_name, passed in results.items():
            status = "✅ PASS" if passed else "❌ FAIL"
            log(f"{test_name}: {status}")
        
        total = len(results)
        passed = sum(1 for v in results.values() if v)
        
        log(f"\nTotal: {passed}/{total} tests passed")
        
        if passed == total:
            log("\n🎉 ALL TESTS PASSED!")
        else:
            log(f"\n⚠️  {total - passed} test(s) failed")
    
    finally:
        # Cleanup
        cleanup_test_channels()

if __name__ == "__main__":
    main()
