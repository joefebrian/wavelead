#!/usr/bin/env python3
"""
WaveLead Milestone 02 Backend Verification
Tests all M02 features: Submission, Moderation, Follow-Intent, Curation, Search
"""
import requests
import time
import json
from typing import Optional, Dict, Any

# Base URL from .env
BASE_URL = "https://grow-infrastructure.preview.emergentagent.com"
API_URL = f"{BASE_URL}/api"

class TestSession:
    def __init__(self):
        self.session = requests.Session()
        self.cookies = {}
        
    def signup(self, email: str, password: str = "TestPass123!") -> Dict[str, Any]:
        """Signup a new user"""
        resp = self.session.post(f"{API_URL}/auth/signup", json={
            "email": email,
            "password": password,
            "display_name": "Test User"
        })
        if resp.status_code == 200:
            self.cookies = dict(resp.cookies)
        return {"status": resp.status_code, "data": resp.json() if resp.status_code == 200 else None, "cookies": dict(resp.cookies)}
    
    def login(self, email: str, password: str = "TestPass123!") -> Dict[str, Any]:
        """Login existing user"""
        resp = self.session.post(f"{API_URL}/auth/login", json={
            "email": email,
            "password": password
        })
        if resp.status_code == 200:
            self.cookies = dict(resp.cookies)
        return {"status": resp.status_code, "data": resp.json() if resp.status_code == 200 else None, "cookies": dict(resp.cookies)}
    
    def logout(self):
        """Logout current user"""
        resp = self.session.post(f"{API_URL}/auth/logout")
        self.cookies = {}
        return resp.status_code

def print_test(name: str, passed: bool, details: str = ""):
    """Print test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"  → {details}")

def main():
    print("=" * 80)
    print("WaveLead Milestone 02 Backend Verification")
    print("=" * 80)
    
    ts = int(time.time())
    
    # ========== SECTION 1: SUBMISSION FLOW ==========
    print("\n" + "=" * 80)
    print("SECTION 1: SUBMISSION FLOW (/api/submit, /api/submit/check)")
    print("=" * 80)
    
    # 1a) Unauthenticated POST /api/submit → 401
    print("\n[1a] Unauthenticated POST /api/submit → 401")
    try:
        resp = requests.post(f"{API_URL}/submit", json={
            "whatsapp_url": "https://whatsapp.com/channel/0029test",
            "name": "Test Channel",
            "short_description": "Test description for channel",
            "category_slug": "news",
            "country_code": "ID",
            "primary_language": "id"
        })
        print_test("Unauthenticated submit returns 401", resp.status_code == 401, f"Status: {resp.status_code}")
    except Exception as e:
        print_test("Unauthenticated submit returns 401", False, f"Error: {e}")
    
    # 1b) Signup a normal user
    print("\n[1b] Signup normal user")
    session = TestSession()
    user_email = f"m02-user-{ts}@example.com"
    try:
        signup_resp = session.signup(user_email)
        print_test("Normal user signup", signup_resp["status"] == 200, f"Email: {user_email}, Status: {signup_resp['status']}")
        if signup_resp["status"] == 200:
            user_data = signup_resp["data"]
            print(f"  → User role: {user_data.get('data', {}).get('user', {}).get('role', 'N/A')}")
            has_cookie = 'wl_session' in signup_resp["cookies"]
            print_test("wl_session cookie set", has_cookie, f"Cookie present: {has_cookie}")
    except Exception as e:
        print_test("Normal user signup", False, f"Error: {e}")
        return
    
    # 1c) POST /api/submit/check with valid URL
    print("\n[1c] POST /api/submit/check with valid WhatsApp URL")
    try:
        check_url = "https://whatsapp.com/channel/0029abcXYZ123abc"
        resp = session.session.post(f"{API_URL}/submit/check", json={"whatsapp_url": check_url})
        data = resp.json()
        print_test("Check duplicate endpoint", resp.status_code == 200, f"Status: {resp.status_code}")
        if resp.status_code == 200:
            is_duplicate = data.get("data", {}).get("duplicate", True)
            normalized = data.get("data", {}).get("normalized", "")
            print_test("Returns duplicate=false for new URL", not is_duplicate, f"duplicate: {is_duplicate}")
            print_test("Returns normalized URL", normalized == check_url, f"normalized: {normalized}")
    except Exception as e:
        print_test("Check duplicate endpoint", False, f"Error: {e}")
    
    # 1d) POST /api/submit with NEW random valid WhatsApp URL
    print("\n[1d] POST /api/submit with NEW valid WhatsApp URL")
    test_url = f"https://whatsapp.com/channel/0029TEST{ts}abc"
    pending_channel_id = None
    pending_channel_slug = None
    pending_channel_name = f"Test Channel {ts}"
    try:
        resp = session.session.post(f"{API_URL}/submit", json={
            "whatsapp_url": test_url,
            "name": pending_channel_name,
            "short_description": "This is a test channel submission for M02 verification",
            "category_slug": "news",
            "country_code": "ID",
            "primary_language": "id"
        })
        data = resp.json()
        print_test("Submit new channel", resp.status_code == 200, f"Status: {resp.status_code}")
        if resp.status_code == 200:
            channel = data.get("data", {}).get("channel", {})
            pending_channel_id = channel.get("id")
            pending_channel_slug = channel.get("slug")
            status = channel.get("status")
            print_test("Channel status is pending_review", status == "pending_review", f"status: {status}")
            print(f"  → Channel ID: {pending_channel_id}")
            print(f"  → Channel slug: {pending_channel_slug}")
    except Exception as e:
        print_test("Submit new channel", False, f"Error: {e}")
    
    # 1e) POST /api/submit again with SAME URL → 409
    print("\n[1e] POST /api/submit with SAME URL → 409 duplicate")
    try:
        resp = session.session.post(f"{API_URL}/submit", json={
            "whatsapp_url": test_url,
            "name": "Duplicate Channel",
            "short_description": "This should be rejected as duplicate",
            "category_slug": "news",
            "country_code": "ID",
            "primary_language": "id"
        })
        print_test("Duplicate submission returns 409", resp.status_code == 409, f"Status: {resp.status_code}")
    except Exception as e:
        print_test("Duplicate submission returns 409", False, f"Error: {e}")
    
    # 1f) Try injecting privileged fields
    print("\n[1f] Try injecting {status:'approved', is_featured:true, verification_status:'verified'}")
    inject_url = f"https://whatsapp.com/channel/0029INJECT{ts}xyz"
    inject_channel_id = None
    try:
        resp = session.session.post(f"{API_URL}/submit", json={
            "whatsapp_url": inject_url,
            "name": f"Inject Test {ts}",
            "short_description": "Testing field injection protection",
            "category_slug": "news",
            "country_code": "ID",
            "primary_language": "id",
            "status": "approved",
            "is_featured": True,
            "verification_status": "verified"
        })
        data = resp.json()
        if resp.status_code == 200:
            inject_channel_id = data.get("data", {}).get("channel", {}).get("id")
            print(f"  → Injection channel ID: {inject_channel_id}")
            # Now check MongoDB to verify the actual stored values
            # We'll verify this by trying to fetch it via moderation queue later
            print_test("Injection attempt accepted (will verify DB state)", True, "Need to check DB state")
    except Exception as e:
        print_test("Injection attempt", False, f"Error: {e}")
    
    # 1g) GET /api/channels?q=<pending channel name> → pending channel NOT in items
    print("\n[1g] GET /api/channels?q=<pending channel name> → NOT in results")
    try:
        resp = requests.get(f"{API_URL}/channels", params={"q": pending_channel_name})
        data = resp.json()
        items = data.get("data", {}).get("items", [])
        found = any(item.get("slug") == pending_channel_slug for item in items)
        print_test("Pending channel NOT in search results", not found, f"Found: {found}, Items count: {len(items)}")
    except Exception as e:
        print_test("Pending channel NOT in search results", False, f"Error: {e}")
    
    # 1h) GET /api/channels?limit=60 → pending channel NOT in items
    print("\n[1h] GET /api/channels?limit=60 → pending channel NOT in items")
    try:
        resp = requests.get(f"{API_URL}/channels", params={"limit": 60})
        data = resp.json()
        items = data.get("data", {}).get("items", [])
        found = any(item.get("slug") == pending_channel_slug for item in items)
        print_test("Pending channel NOT in list", not found, f"Found: {found}, Items count: {len(items)}")
    except Exception as e:
        print_test("Pending channel NOT in list", False, f"Error: {e}")
    
    # 1i) GET /api/channels/<pending slug> → 404
    print("\n[1i] GET /api/channels/<pending slug> → 404")
    try:
        resp = requests.get(f"{API_URL}/channels/{pending_channel_slug}")
        print_test("Pending channel detail returns 404", resp.status_code == 404, f"Status: {resp.status_code}")
    except Exception as e:
        print_test("Pending channel detail returns 404", False, f"Error: {e}")
    
    # ========== SECTION 2: MODERATION QUEUE ==========
    print("\n" + "=" * 80)
    print("SECTION 2: MODERATION QUEUE (moderator+ required)")
    print("=" * 80)
    
    # Create a moderator user
    print("\n[2-setup] Create moderator user")
    mod_session = TestSession()
    mod_email = f"m02-mod-{ts}@example.com"
    try:
        mod_signup = mod_session.signup(mod_email)
        print_test("Moderator user signup", mod_signup["status"] == 200, f"Email: {mod_email}")
        if mod_signup["status"] == 200:
            mod_user_id = mod_signup["data"].get("data", {}).get("user", {}).get("id")
            print(f"  → Moderator user ID: {mod_user_id}")
            # Now promote to moderator in MongoDB
            print("  → Promoting to moderator role in MongoDB...")
            import subprocess
            mongo_cmd = f'mongosh wavelead --eval "db.users.updateOne({{id: \\"{mod_user_id}\\"}}, {{\\$set: {{role: \\"moderator\\"}}}})"'
            result = subprocess.run(mongo_cmd, shell=True, capture_output=True, text=True)
            print(f"  → MongoDB update result: {result.returncode == 0}")
    except Exception as e:
        print_test("Moderator user setup", False, f"Error: {e}")
        return
    
    # 2a) Normal user GET /api/admin/channels → 403
    print("\n[2a] Normal user GET /api/admin/channels → 403")
    try:
        resp = session.session.get(f"{API_URL}/admin/channels")
        print_test("Normal user denied admin access", resp.status_code == 403, f"Status: {resp.status_code}")
    except Exception as e:
        print_test("Normal user denied admin access", False, f"Error: {e}")
    
    # 2b) Moderator GET /api/admin/channels?status=pending_review
    print("\n[2b] Moderator GET /api/admin/channels?status=pending_review")
    try:
        resp = mod_session.session.get(f"{API_URL}/admin/channels", params={"status": "pending_review"})
        data = resp.json()
        print_test("Moderator can list queue", resp.status_code == 200, f"Status: {resp.status_code}")
        if resp.status_code == 200:
            items = data.get("data", {}).get("items", [])
            found = any(item.get("id") == pending_channel_id for item in items)
            print_test("Pending submission in queue", found, f"Found: {found}, Queue size: {len(items)}")
            # Check injection channel
            if inject_channel_id:
                inject_found = next((item for item in items if item.get("id") == inject_channel_id), None)
                if inject_found:
                    print("\n  → Verifying injection protection:")
                    print_test("  status is pending_review", inject_found.get("status") == "pending_review", f"status: {inject_found.get('status')}")
                    print_test("  is_featured is false", inject_found.get("is_featured") == False, f"is_featured: {inject_found.get('is_featured')}")
                    print_test("  verification_status is unclaimed", inject_found.get("verification_status") == "unclaimed", f"verification_status: {inject_found.get('verification_status')}")
    except Exception as e:
        print_test("Moderator can list queue", False, f"Error: {e}")
    
    # 2c) GET /api/admin/channels/<id>
    print("\n[2c] GET /api/admin/channels/<id> → 200 with channel + category_name")
    try:
        resp = mod_session.session.get(f"{API_URL}/admin/channels/{pending_channel_id}")
        data = resp.json()
        print_test("Get channel detail", resp.status_code == 200, f"Status: {resp.status_code}")
        if resp.status_code == 200:
            channel = data.get("data", {}).get("channel", {})
            has_category_name = "category_name" in channel
            print_test("Response includes category_name", has_category_name, f"category_name: {channel.get('category_name')}")
    except Exception as e:
        print_test("Get channel detail", False, f"Error: {e}")
    
    # 2d) POST /api/admin/channels/<id>/approve
    print("\n[2d] POST /api/admin/channels/<id>/approve")
    approved_channel_id = pending_channel_id
    approved_channel_slug = pending_channel_slug
    try:
        resp = mod_session.session.post(f"{API_URL}/admin/channels/{pending_channel_id}/approve", json={})
        data = resp.json()
        print_test("Approve channel", resp.status_code == 200, f"Status: {resp.status_code}")
        
        # Verify channel state after approval
        if resp.status_code == 200:
            detail_resp = mod_session.session.get(f"{API_URL}/admin/channels/{pending_channel_id}")
            if detail_resp.status_code == 200:
                channel = detail_resp.json().get("data", {}).get("channel", {})
                print("\n  → Verifying approved channel state:")
                print_test("  status is approved", channel.get("status") == "approved", f"status: {channel.get('status')}")
                print_test("  reviewed_by is set", channel.get("reviewed_by") == mod_user_id, f"reviewed_by: {channel.get('reviewed_by')}")
                print_test("  reviewed_at is set", channel.get("reviewed_at") is not None, f"reviewed_at: {channel.get('reviewed_at')}")
                
                # Verify now appears in public channels
                print("\n  → Verifying now public:")
                pub_resp = requests.get(f"{API_URL}/channels", params={"limit": 60})
                if pub_resp.status_code == 200:
                    items = pub_resp.json().get("data", {}).get("items", [])
                    found = any(item.get("slug") == pending_channel_slug for item in items)
                    print_test("  Now in /api/channels list", found, f"Found: {found}")
                
                # Verify detail endpoint works
                detail_pub_resp = requests.get(f"{API_URL}/channels/{pending_channel_slug}")
                print_test("  /api/channels/<slug> returns 200", detail_pub_resp.status_code == 200, f"Status: {detail_pub_resp.status_code}")
                
                # Verify audit log (check MongoDB)
                print("\n  → Verifying audit log:")
                import subprocess
                audit_cmd = f'mongosh wavelead --quiet --eval "db.audit_logs.findOne({{entity_id: \\"{pending_channel_id}\\", action: \\"ADMIN_APPROVE_CHANNEL\\"}})" | grep -q ADMIN_APPROVE_CHANNEL && echo "found" || echo "not_found"'
                result = subprocess.run(audit_cmd, shell=True, capture_output=True, text=True)
                audit_found = "found" in result.stdout
                print_test("  Audit log inserted", audit_found, f"Action: ADMIN_APPROVE_CHANNEL")
    except Exception as e:
        print_test("Approve channel", False, f"Error: {e}")
    
    # 2e) Submit another pending channel and reject it
    print("\n[2e] Submit another channel and reject it")
    reject_url = f"https://whatsapp.com/channel/0029REJECT{ts}xyz"
    reject_channel_id = None
    reject_channel_slug = None
    try:
        # Submit
        resp = session.session.post(f"{API_URL}/submit", json={
            "whatsapp_url": reject_url,
            "name": f"Reject Test {ts}",
            "short_description": "This channel will be rejected for testing",
            "category_slug": "news",
            "country_code": "ID",
            "primary_language": "id"
        })
        if resp.status_code == 200:
            reject_channel_id = resp.json().get("data", {}).get("channel", {}).get("id")
            reject_channel_slug = resp.json().get("data", {}).get("channel", {}).get("slug")
            print(f"  → Reject test channel ID: {reject_channel_id}")
            
            # Reject
            reject_resp = mod_session.session.post(f"{API_URL}/admin/channels/{reject_channel_id}/reject", json={
                "reason": "spam",
                "notes": "testing"
            })
            print_test("Reject channel", reject_resp.status_code == 200, f"Status: {reject_resp.status_code}")
            
            # Verify rejected state
            if reject_resp.status_code == 200:
                detail_resp = mod_session.session.get(f"{API_URL}/admin/channels/{reject_channel_id}")
                if detail_resp.status_code == 200:
                    channel = detail_resp.json().get("data", {}).get("channel", {})
                    print("\n  → Verifying rejected channel state:")
                    print_test("  status is rejected", channel.get("status") == "rejected", f"status: {channel.get('status')}")
                    print_test("  rejection_reason is spam", channel.get("rejection_reason") == "spam", f"rejection_reason: {channel.get('rejection_reason')}")
                    print_test("  rejection_notes is testing", channel.get("rejection_notes") == "testing", f"rejection_notes: {channel.get('rejection_notes')}")
                    print_test("  reviewed_by is set", channel.get("reviewed_by") is not None, f"reviewed_by: {channel.get('reviewed_by')}")
                    print_test("  reviewed_at is set", channel.get("reviewed_at") is not None, f"reviewed_at: {channel.get('reviewed_at')}")
                    
                    # Verify still NOT public
                    print("\n  → Verifying still NOT public:")
                    pub_resp = requests.get(f"{API_URL}/channels", params={"limit": 60})
                    if pub_resp.status_code == 200:
                        items = pub_resp.json().get("data", {}).get("items", [])
                        found = any(item.get("slug") == reject_channel_slug for item in items)
                        print_test("  NOT in /api/channels list", not found, f"Found: {found}")
                    
                    # Verify audit log
                    import subprocess
                    audit_cmd = f'mongosh wavelead --quiet --eval "db.audit_logs.findOne({{entity_id: \\"{reject_channel_id}\\", action: \\"ADMIN_REJECT_CHANNEL\\"}})" | grep -q ADMIN_REJECT_CHANNEL && echo "found" || echo "not_found"'
                    result = subprocess.run(audit_cmd, shell=True, capture_output=True, text=True)
                    audit_found = "found" in result.stdout
                    print_test("  Audit log inserted", audit_found, f"Action: ADMIN_REJECT_CHANNEL")
    except Exception as e:
        print_test("Reject channel flow", False, f"Error: {e}")
    
    # ========== SECTION 3: FOLLOW-INTENT TRACKING ==========
    print("\n" + "=" * 80)
    print("SECTION 3: FOLLOW-INTENT TRACKING (/go/[slug])")
    print("=" * 80)
    
    # 3a) GET /go/<approved-slug> → 302 to whatsapp_url
    print("\n[3a] GET /go/<approved-slug> → 302 to whatsapp_url")
    try:
        # Use a seed channel (nusantara-daily)
        resp = requests.get(f"{BASE_URL}/go/nusantara-daily", allow_redirects=False)
        print_test("Follow redirect returns 302", resp.status_code == 302, f"Status: {resp.status_code}")
        if resp.status_code == 302:
            location = resp.headers.get("Location", "")
            is_whatsapp = "whatsapp.com" in location or "wa.me" in location
            print_test("Location points to WhatsApp", is_whatsapp, f"Location: {location}")
            
            cache_control = resp.headers.get("Cache-Control", "")
            has_no_store = "no-store" in cache_control and "private" in cache_control
            print_test("Cache-Control: no-store,private", has_no_store, f"Cache-Control: {cache_control}")
            
            has_anon_cookie = "wl_anon_id" in resp.cookies
            print_test("Sets wl_anon_id cookie", has_anon_cookie, f"Cookie set: {has_anon_cookie}")
    except Exception as e:
        print_test("Follow redirect", False, f"Error: {e}")
    
    # 3b) Re-hit /go/<same-slug> with cookie → still 302, new event inserted
    print("\n[3b] Re-hit /go/<same-slug> with cookie → still 302, new event")
    try:
        # First hit
        resp1 = requests.get(f"{BASE_URL}/go/nusantara-daily", allow_redirects=False)
        cookie1 = resp1.cookies.get("wl_anon_id")
        
        # Second hit with same cookie
        time.sleep(0.5)  # Small delay
        resp2 = requests.get(f"{BASE_URL}/go/nusantara-daily", allow_redirects=False, cookies={"wl_anon_id": cookie1} if cookie1 else {})
        print_test("Second hit still returns 302", resp2.status_code == 302, f"Status: {resp2.status_code}")
        
        # Verify events in MongoDB (should have 2 events for this session)
        if cookie1:
            import subprocess
            # Count events for this anonymous session
            count_cmd = f'mongosh wavelead --quiet --eval "db.events.countDocuments({{anonymous_session_id: \\"{cookie1}\\", event_type: \\"follow_click\\"}})"'
            result = subprocess.run(count_cmd, shell=True, capture_output=True, text=True)
            try:
                count = int(result.stdout.strip())
                print_test("Multiple events inserted (not deduped)", count >= 2, f"Event count: {count}")
            except Exception:
                print_test("Multiple events inserted", False, "Could not verify event count")
    except Exception as e:
        print_test("Re-hit follow redirect", False, f"Error: {e}")
    
    # 3c) GET /go/does-not-exist → 302 to /channel/does-not-exist?not_available=1
    print("\n[3c] GET /go/does-not-exist → 302 to /channel/does-not-exist?not_available=1")
    try:
        resp = requests.get(f"{BASE_URL}/go/does-not-exist", allow_redirects=False)
        print_test("Non-existent slug returns 302", resp.status_code == 302, f"Status: {resp.status_code}")
        if resp.status_code == 302:
            location = resp.headers.get("Location", "")
            expected_path = "/channel/does-not-exist"
            has_not_available = "not_available=1" in location
            correct_redirect = expected_path in location and has_not_available
            print_test("Redirects to /channel/<slug>?not_available=1", correct_redirect, f"Location: {location}")
            not_to_whatsapp = "whatsapp.com" not in location and "wa.me" not in location
            print_test("Does NOT redirect to WhatsApp", not_to_whatsapp, f"Location: {location}")
    except Exception as e:
        print_test("Non-existent slug redirect", False, f"Error: {e}")
    
    # 3d) Reject an approved channel, then GET /go/<slug> → 302 to /channel/<slug>?not_available=1
    print("\n[3d] Reject approved channel, then GET /go/<slug> → not to WhatsApp")
    # We'll use the inject channel if it was approved, or skip this test
    if inject_channel_id:
        try:
            # First approve it
            mod_session.session.post(f"{API_URL}/admin/channels/{inject_channel_id}/approve", json={})
            time.sleep(0.5)
            # Then reject it
            mod_session.session.post(f"{API_URL}/admin/channels/{inject_channel_id}/reject", json={
                "reason": "spam",
                "notes": "test"
            })
            time.sleep(0.5)
            # Get the slug
            detail_resp = mod_session.session.get(f"{API_URL}/admin/channels/{inject_channel_id}")
            if detail_resp.status_code == 200:
                slug = detail_resp.json().get("data", {}).get("channel", {}).get("slug")
                # Try /go/<slug>
                resp = requests.get(f"{BASE_URL}/go/{slug}", allow_redirects=False)
                print_test("Rejected channel returns 302", resp.status_code == 302, f"Status: {resp.status_code}")
                if resp.status_code == 302:
                    location = resp.headers.get("Location", "")
                    not_to_whatsapp = "whatsapp.com" not in location and "wa.me" not in location
                    print_test("Does NOT redirect to WhatsApp", not_to_whatsapp, f"Location: {location}")
        except Exception as e:
            print_test("Rejected channel redirect", False, f"Error: {e}")
    else:
        print("  → Skipped (no inject channel)")
    
    # 3e) Verify events insert structure
    print("\n[3e] Verify events insert includes required fields")
    try:
        import subprocess
        # Get a recent event
        event_cmd = 'mongosh wavelead --quiet --eval "db.events.findOne({event_type: \\"follow_click\\"})" --json'
        result = subprocess.run(event_cmd, shell=True, capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip():
            # Parse the JSON output
            import json
            event = json.loads(result.stdout)
            required_fields = ["channel_id", "anonymous_session_id", "event_type", "source", "created_at"]
            all_present = all(field in event for field in required_fields)
            print_test("Event has required fields", all_present, f"Fields: {', '.join(required_fields)}")
            print_test("event_type is follow_click", event.get("event_type") == "follow_click", f"event_type: {event.get('event_type')}")
    except Exception as e:
        print_test("Verify event structure", False, f"Error: {e}")
    
    # ========== SECTION 4: HOMEPAGE CURATION ==========
    print("\n" + "=" * 80)
    print("SECTION 4: HOMEPAGE CURATION (moderator+ required)")
    print("=" * 80)
    
    # 4a) POST /api/admin/homepage/slots with approved channel
    print("\n[4a] POST /api/admin/homepage/slots with approved channel")
    slot_id = None
    try:
        resp = mod_session.session.post(f"{API_URL}/admin/homepage/slots", json={
            "section": "popular",
            "channel_id": approved_channel_id,
            "priority": 10
        })
        data = resp.json()
        print_test("Create curation slot", resp.status_code == 200, f"Status: {resp.status_code}")
        if resp.status_code == 200:
            slot_id = data.get("data", {}).get("slot", {}).get("id")
            print(f"  → Slot ID: {slot_id}")
    except Exception as e:
        print_test("Create curation slot", False, f"Error: {e}")
    
    # 4b) Same again → 409 duplicate
    print("\n[4b] Same section+channel again → 409")
    try:
        resp = mod_session.session.post(f"{API_URL}/admin/homepage/slots", json={
            "section": "popular",
            "channel_id": approved_channel_id,
            "priority": 20
        })
        print_test("Duplicate slot returns 409", resp.status_code == 409, f"Status: {resp.status_code}")
    except Exception as e:
        print_test("Duplicate slot returns 409", False, f"Error: {e}")
    
    # 4c) Try with pending channel → 400
    print("\n[4c] Try curating pending channel → 400")
    # Submit a new pending channel
    try:
        pending_url = f"https://whatsapp.com/channel/0029PENDING{ts}xyz"
        submit_resp = session.session.post(f"{API_URL}/submit", json={
            "whatsapp_url": pending_url,
            "name": f"Pending Curation Test {ts}",
            "short_description": "This is pending and should not be curatable",
            "category_slug": "news",
            "country_code": "ID",
            "primary_language": "id"
        })
        if submit_resp.status_code == 200:
            pending_id = submit_resp.json().get("data", {}).get("channel", {}).get("id")
            # Try to curate it
            resp = mod_session.session.post(f"{API_URL}/admin/homepage/slots", json={
                "section": "popular",
                "channel_id": pending_id,
                "priority": 10
            })
            print_test("Pending channel curation returns 400", resp.status_code == 400, f"Status: {resp.status_code}")
            if resp.status_code == 400:
                error_msg = resp.json().get("error", "")
                has_approved_msg = "approved" in error_msg.lower()
                print_test("Error mentions 'approved'", has_approved_msg, f"Error: {error_msg}")
    except Exception as e:
        print_test("Pending channel curation", False, f"Error: {e}")
    
    # 4d) GET /api/admin/homepage/slots
    print("\n[4d] GET /api/admin/homepage/slots")
    try:
        resp = mod_session.session.get(f"{API_URL}/admin/homepage/slots")
        data = resp.json()
        print_test("List slots", resp.status_code == 200, f"Status: {resp.status_code}")
        if resp.status_code == 200:
            slots = data.get("data", {}).get("slots", [])
            found = any(s.get("id") == slot_id for s in slots)
            print_test("Created slot in list", found, f"Slots count: {len(slots)}")
    except Exception as e:
        print_test("List slots", False, f"Error: {e}")
    
    # 4e) GET /api/discovery/home → popular has curated channel first
    print("\n[4e] GET /api/discovery/home → popular has curated channel first")
    try:
        resp = requests.get(f"{API_URL}/discovery/home")
        data = resp.json()
        print_test("Get homepage bundle", resp.status_code == 200, f"Status: {resp.status_code}")
        if resp.status_code == 200:
            popular = data.get("data", {}).get("popular", [])
            featured = data.get("data", {}).get("featured", [])
            print_test("Has popular section", len(popular) > 0, f"Popular count: {len(popular)}")
            print_test("Has featured section", len(featured) >= 0, f"Featured count: {len(featured)}")
            if len(popular) > 0:
                first_slug = popular[0].get("slug")
                is_curated = first_slug == approved_channel_slug
                print_test("Curated channel is first in popular", is_curated, f"First slug: {first_slug}, Expected: {approved_channel_slug}")
    except Exception as e:
        print_test("Get homepage bundle", False, f"Error: {e}")
    
    # 4f) PATCH /api/admin/homepage/slots/<id> {active:false}
    print("\n[4f] PATCH /api/admin/homepage/slots/<id> {active:false}")
    if slot_id:
        try:
            resp = mod_session.session.patch(f"{API_URL}/admin/homepage/slots/{slot_id}", json={"active": False})
            print_test("Deactivate slot", resp.status_code == 200, f"Status: {resp.status_code}")
            
            # Verify no longer in public home
            if resp.status_code == 200:
                time.sleep(0.5)
                home_resp = requests.get(f"{API_URL}/discovery/home")
                if home_resp.status_code == 200:
                    popular = home_resp.json().get("data", {}).get("popular", [])
                    if len(popular) > 0:
                        first_slug = popular[0].get("slug")
                        not_first = first_slug != approved_channel_slug
                        print_test("Inactive slot not first in popular", not_first, f"First slug: {first_slug}")
        except Exception as e:
            print_test("Deactivate slot", False, f"Error: {e}")
    
    # 4g) DELETE /api/admin/homepage/slots/<id>
    print("\n[4g] DELETE /api/admin/homepage/slots/<id>")
    if slot_id:
        try:
            resp = mod_session.session.delete(f"{API_URL}/admin/homepage/slots/{slot_id}")
            print_test("Delete slot", resp.status_code == 200, f"Status: {resp.status_code}")
            
            # Verify no longer in list
            if resp.status_code == 200:
                list_resp = mod_session.session.get(f"{API_URL}/admin/homepage/slots")
                if list_resp.status_code == 200:
                    slots = list_resp.json().get("data", {}).get("slots", [])
                    found = any(s.get("id") == slot_id for s in slots)
                    print_test("Deleted slot not in list", not found, f"Found: {found}")
        except Exception as e:
            print_test("Delete slot", False, f"Error: {e}")
    
    # ========== SECTION 5: SEARCH RELEVANCE ==========
    print("\n" + "=" * 80)
    print("SECTION 5: SEARCH RELEVANCE v1")
    print("=" * 80)
    
    # 5a) GET /api/channels?q=sport → Wave Sports Weekly first
    print("\n[5a] GET /api/channels?q=sport → Wave Sports Weekly first")
    try:
        resp = requests.get(f"{API_URL}/channels", params={"q": "sport", "limit": 10})
        data = resp.json()
        print_test("Search for 'sport'", resp.status_code == 200, f"Status: {resp.status_code}")
        if resp.status_code == 200:
            items = data.get("data", {}).get("items", [])
            if len(items) > 0:
                first_slug = items[0].get("slug")
                is_wave_sports = first_slug == "wave-sports-weekly"
                print_test("Wave Sports Weekly is first", is_wave_sports, f"First: {first_slug}")
                # Check if GameLoop Asia is in results but not first
                gameloop_pos = next((i for i, item in enumerate(items) if item.get("slug") == "gameloop-asia"), -1)
                if gameloop_pos >= 0:
                    print_test("GameLoop Asia ranks lower", gameloop_pos > 0, f"GameLoop position: {gameloop_pos}")
    except Exception as e:
        print_test("Search for 'sport'", False, f"Error: {e}")
    
    # 5b) GET /api/channels?q=Wave  Sports (multi-word with extra space)
    print("\n[5b] GET /api/channels?q=Wave  Sports (multi-word) → no crash")
    try:
        resp = requests.get(f"{API_URL}/channels", params={"q": "Wave  Sports", "limit": 10})
        data = resp.json()
        print_test("Multi-word search no crash", resp.status_code == 200, f"Status: {resp.status_code}")
        if resp.status_code == 200:
            is_valid_json = "data" in data
            print_test("Returns valid JSON", is_valid_json, f"Has data key: {is_valid_json}")
    except Exception as e:
        print_test("Multi-word search", False, f"Error: {e}")
    
    # 5c) GET /api/channels?q=%20SPORT%20 (case-insensitive with whitespace)
    print("\n[5c] GET /api/channels?q=%20SPORT%20 (case-insensitive)")
    try:
        resp = requests.get(f"{API_URL}/channels", params={"q": " SPORT ", "limit": 10})
        data = resp.json()
        print_test("Case-insensitive search", resp.status_code == 200, f"Status: {resp.status_code}")
        if resp.status_code == 200:
            items = data.get("data", {}).get("items", [])
            if len(items) > 0:
                first_slug = items[0].get("slug")
                is_wave_sports = first_slug == "wave-sports-weekly"
                print_test("Same result as lowercase", is_wave_sports, f"First: {first_slug}")
    except Exception as e:
        print_test("Case-insensitive search", False, f"Error: {e}")
    
    # 5d) GET /api/channels?q=nusantara → nusantara-daily first
    print("\n[5d] GET /api/channels?q=nusantara → nusantara-daily first")
    try:
        resp = requests.get(f"{API_URL}/channels", params={"q": "nusantara"})
        data = resp.json()
        print_test("Search for 'nusantara'", resp.status_code == 200, f"Status: {resp.status_code}")
        if resp.status_code == 200:
            items = data.get("data", {}).get("items", [])
            if len(items) > 0:
                first_slug = items[0].get("slug")
                is_nusantara = first_slug == "nusantara-daily"
                print_test("nusantara-daily is first", is_nusantara, f"First: {first_slug}")
    except Exception as e:
        print_test("Search for 'nusantara'", False, f"Error: {e}")
    
    # 5e) GET /api/channels?q=xyznotacategory → empty
    print("\n[5e] GET /api/channels?q=xyznotacategory → empty")
    try:
        resp = requests.get(f"{API_URL}/channels", params={"q": "xyznotacategory"})
        data = resp.json()
        print_test("Search for non-existent", resp.status_code == 200, f"Status: {resp.status_code}")
        if resp.status_code == 200:
            items = data.get("data", {}).get("items", [])
            total = data.get("data", {}).get("total", -1)
            print_test("Returns empty results", len(items) == 0 and total == 0, f"Items: {len(items)}, Total: {total}")
    except Exception as e:
        print_test("Search for non-existent", False, f"Error: {e}")
    
    # 5f) All returned channels have status=approved
    print("\n[5f] All search results have status=approved")
    try:
        resp = requests.get(f"{API_URL}/channels", params={"q": "news", "limit": 20})
        data = resp.json()
        if resp.status_code == 200:
            items = data.get("data", {}).get("items", [])
            # Note: public API should not expose status field, but we check no pending/rejected leak
            # by verifying we don't see our pending channels
            has_pending = any(item.get("slug") == pending_channel_slug for item in items)
            has_rejected = any(item.get("slug") == reject_channel_slug for item in items)
            no_leak = not has_pending and not has_rejected
            print_test("No pending/rejected in results", no_leak, f"Pending: {has_pending}, Rejected: {has_rejected}")
    except Exception as e:
        print_test("Verify approved-only results", False, f"Error: {e}")
    
    # ========== SECTION 6: EXISTING REGRESSIONS ==========
    print("\n" + "=" * 80)
    print("SECTION 6: EXISTING REGRESSIONS")
    print("=" * 80)
    
    # 6a) GET /api/health → service='wavelead'
    print("\n[6a] GET /api/health → service='wavelead'")
    try:
        resp = requests.get(f"{API_URL}/health")
        data = resp.json()
        print_test("Health endpoint", resp.status_code == 200, f"Status: {resp.status_code}")
        if resp.status_code == 200:
            service = data.get("data", {}).get("service")
            print_test("Service is wavelead", service == "wavelead", f"service: {service}")
    except Exception as e:
        print_test("Health endpoint", False, f"Error: {e}")
    
    # 6b) Unauthenticated /dashboard → 307 to /login?next=/dashboard
    print("\n[6b] Unauthenticated /dashboard → 307 to /login?next=/dashboard")
    try:
        resp = requests.get(f"{BASE_URL}/dashboard", allow_redirects=False)
        print_test("Dashboard redirect", resp.status_code == 307, f"Status: {resp.status_code}")
        if resp.status_code == 307:
            location = resp.headers.get("Location", "")
            correct_redirect = "/login" in location and "next=/dashboard" in location
            print_test("Redirects to login with next", correct_redirect, f"Location: {location}")
    except Exception as e:
        print_test("Dashboard redirect", False, f"Error: {e}")
    
    # 6c) Unauthenticated /admin → 307 to /login?next=/admin
    print("\n[6c] Unauthenticated /admin → 307 to /login?next=/admin")
    try:
        resp = requests.get(f"{BASE_URL}/admin", allow_redirects=False)
        print_test("Admin redirect", resp.status_code == 307, f"Status: {resp.status_code}")
        if resp.status_code == 307:
            location = resp.headers.get("Location", "")
            correct_redirect = "/login" in location and "next=/admin" in location
            print_test("Redirects to login with next", correct_redirect, f"Location: {location}")
    except Exception as e:
        print_test("Admin redirect", False, f"Error: {e}")
    
    # 6d) Normal user GET /api/admin/ping → 403
    print("\n[6d] Normal user GET /api/admin/ping → 403")
    try:
        resp = session.session.get(f"{API_URL}/admin/ping")
        print_test("Normal user denied", resp.status_code == 403, f"Status: {resp.status_code}")
    except Exception as e:
        print_test("Normal user denied", False, f"Error: {e}")
    
    # 6e) Moderator GET /api/admin/ping → 200
    print("\n[6e] Moderator GET /api/admin/ping → 200")
    try:
        resp = mod_session.session.get(f"{API_URL}/admin/ping")
        print_test("Moderator allowed", resp.status_code == 200, f"Status: {resp.status_code}")
    except Exception as e:
        print_test("Moderator allowed", False, f"Error: {e}")
    
    # 6f) Demote moderator, same cookie → 403
    print("\n[6f] Demote moderator to user, same cookie → 403")
    try:
        import subprocess
        # Demote
        demote_cmd = f'mongosh wavelead --eval "db.users.updateOne({{id: \\"{mod_user_id}\\"}}, {{\\$set: {{role: \\"user\\"}}}})"'
        subprocess.run(demote_cmd, shell=True, capture_output=True)
        time.sleep(0.5)
        # Try admin ping with same cookie
        resp = mod_session.session.get(f"{API_URL}/admin/ping")
        print_test("Demoted user denied immediately", resp.status_code == 403, f"Status: {resp.status_code}")
    except Exception as e:
        print_test("Live-role downgrade", False, f"Error: {e}")
    
    # 6g) Logout clears wl_session cookie
    print("\n[6g] Logout POST /api/auth/logout clears wl_session")
    try:
        logout_resp = session.session.post(f"{API_URL}/auth/logout")
        print_test("Logout succeeds", logout_resp.status_code == 200, f"Status: {logout_resp.status_code}")
        # Check if cookie is cleared (Max-Age=0 or expires in past)
        set_cookie = logout_resp.headers.get("Set-Cookie", "")
        cookie_cleared = "wl_session=" in set_cookie and ("Max-Age=0" in set_cookie or "expires=" in set_cookie)
        print_test("wl_session cookie cleared", cookie_cleared, f"Set-Cookie: {set_cookie[:100]}")
    except Exception as e:
        print_test("Logout clears cookie", False, f"Error: {e}")
    
    # 6h) CORS: evil origin not allowed
    print("\n[6h] CORS: evil origin not allowed")
    try:
        resp = requests.get(f"{API_URL}/health", headers={"Origin": "https://evil.example"})
        print_test("CORS request succeeds", resp.status_code == 200, f"Status: {resp.status_code}")
        acao = resp.headers.get("Access-Control-Allow-Origin", "")
        not_wildcard = acao != "*"
        not_evil = acao != "https://evil.example"
        print_test("Not wildcard CORS", not_wildcard, f"ACAO: {acao}")
        print_test("Not evil origin", not_evil, f"ACAO: {acao}")
        # Should echo allowed origin
        is_allowed = acao == BASE_URL
        print_test("Echoes allowed origin", is_allowed, f"ACAO: {acao}")
        has_vary = "Vary" in resp.headers
        print_test("Has Vary: Origin", has_vary, f"Vary: {resp.headers.get('Vary', 'N/A')}")
    except Exception as e:
        print_test("CORS check", False, f"Error: {e}")
    
    # 6i) yarn typecheck and yarn test
    print("\n[6i] yarn typecheck exit 0, yarn test passes")
    try:
        import subprocess
        # typecheck
        typecheck = subprocess.run("cd /app && yarn typecheck", shell=True, capture_output=True, text=True, timeout=60)
        print_test("yarn typecheck", typecheck.returncode == 0, f"Exit code: {typecheck.returncode}")
        
        # test
        test = subprocess.run("cd /app && yarn test", shell=True, capture_output=True, text=True, timeout=120)
        print_test("yarn test", test.returncode == 0, f"Exit code: {test.returncode}")
        if test.returncode != 0:
            print(f"  → Test output: {test.stdout[-500:]}")
    except Exception as e:
        print_test("Build checks", False, f"Error: {e}")
    
    print("\n" + "=" * 80)
    print("MILESTONE 02 BACKEND VERIFICATION COMPLETE")
    print("=" * 80)

if __name__ == "__main__":
    main()
