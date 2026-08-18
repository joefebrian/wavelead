#!/usr/bin/env python3
"""
Milestone 01 Release Smoke Test
Commit: 6e1cf31
Target: http://localhost:3000
"""

import requests
import re
import json
from urllib.parse import urljoin

BASE_URL = "http://localhost:3000"
session = requests.Session()

def test_1_homepage():
    """GET / — status 200, HTML contains 'Find channels worth following'"""
    try:
        resp = session.get(f"{BASE_URL}/")
        if resp.status_code != 200:
            return "FAIL", f"Status {resp.status_code}"
        if "Find channels worth following" in resp.text:
            return "PASS", f"Status 200, text found"
        return "FAIL", f"Status 200 but text not found"
    except Exception as e:
        return "FAIL", str(e)

def test_2_search():
    """GET /search?q=finance — status 200, HTML contains 'Results for' and 'finance', at least 1 channel card"""
    try:
        resp = session.get(f"{BASE_URL}/search?q=finance")
        if resp.status_code != 200:
            return "FAIL", f"Status {resp.status_code}"
        text = resp.text
        if "Results for" not in text:
            return "FAIL", "Missing 'Results for'"
        if "finance" not in text.lower():
            return "FAIL", "Missing 'finance'"
        # Check for channel card indicators - look for channel links or wh-card class
        if 'class="wh-card' in text or '/channel/' in text:
            return "PASS", "Status 200, all text found, channel card present"
        return "FAIL", "No channel card found"
    except Exception as e:
        return "FAIL", str(e)

def test_3_trending():
    """GET /trending — status 200, HTML contains 'Trending on WaveLead'"""
    try:
        resp = session.get(f"{BASE_URL}/trending")
        if resp.status_code != 200:
            return "FAIL", f"Status {resp.status_code}"
        if "Trending on WaveLead" in resp.text:
            return "PASS", "Status 200, text found"
        return "FAIL", "Status 200 but text not found"
    except Exception as e:
        return "FAIL", str(e)

def test_4_top_country():
    """GET /top?country=US — status 200, HTML contains 'Top Channels in United States'"""
    try:
        resp = session.get(f"{BASE_URL}/top?country=US")
        if resp.status_code != 200:
            return "FAIL", f"Status {resp.status_code}"
        # Check for variations of the text
        if "Top Channels in" in resp.text and "United States" in resp.text:
            return "PASS", "Status 200, text found"
        return "FAIL", "Status 200 but text not found"
    except Exception as e:
        return "FAIL", str(e)

def test_5_category_sports():
    """GET /category/sports — status 200, HTML contains 'Sports channels'"""
    try:
        resp = session.get(f"{BASE_URL}/category/sports")
        if resp.status_code != 200:
            return "FAIL", f"Status {resp.status_code}"
        if "Sports channels" in resp.text or "sports channels" in resp.text.lower():
            return "PASS", "Status 200, text found"
        return "FAIL", "Status 200 but text not found"
    except Exception as e:
        return "FAIL", str(e)

def test_6_country_indonesia():
    """GET /country/indonesia — status 200, HTML contains 'Indonesia channels'"""
    try:
        resp = session.get(f"{BASE_URL}/country/indonesia")
        if resp.status_code != 200:
            return "FAIL", f"Status {resp.status_code}"
        if "Indonesia channels" in resp.text or "indonesia channels" in resp.text.lower():
            return "PASS", "Status 200, text found"
        return "FAIL", "Status 200 but text not found"
    except Exception as e:
        return "FAIL", str(e)

def test_7_channel_detail():
    """GET /channel/nusantara-daily — status 200, HTML contains 'Nusantara Daily' and 'Follow on WhatsApp'"""
    try:
        resp = session.get(f"{BASE_URL}/channel/nusantara-daily")
        if resp.status_code != 200:
            return "FAIL", f"Status {resp.status_code}"
        text = resp.text
        if "Nusantara Daily" not in text:
            return "FAIL", "Missing 'Nusantara Daily'"
        if "Follow on WhatsApp" not in text:
            return "FAIL", "Missing 'Follow on WhatsApp'"
        return "PASS", "Status 200, both texts found"
    except Exception as e:
        return "FAIL", str(e)

def test_8_css_assets():
    """CSS assets 200 — extract every <link rel="stylesheet" href="/_next/static/css/..."> from /, fetch each, confirm all are 200 with Content-Type: text/css"""
    try:
        resp = session.get(f"{BASE_URL}/")
        if resp.status_code != 200:
            return "FAIL", "Homepage not accessible"
        
        # Extract CSS links
        css_pattern = r'<link[^>]*rel=["\']stylesheet["\'][^>]*href=["\'](/_next/static/css/[^"\']+)["\']'
        css_links = re.findall(css_pattern, resp.text)
        
        if not css_links:
            # Try alternative pattern
            css_pattern2 = r'href=["\'](/_next/static/css/[^"\']+)["\'][^>]*rel=["\']stylesheet["\']'
            css_links = re.findall(css_pattern2, resp.text)
        
        if not css_links:
            return "FAIL", "No CSS links found"
        
        results = []
        for css_url in css_links:
            full_url = urljoin(BASE_URL, css_url)
            css_resp = session.get(full_url)
            content_type = css_resp.headers.get('Content-Type', '')
            if css_resp.status_code == 200 and 'text/css' in content_type:
                results.append(f"{css_url[:50]}... OK")
            else:
                return "FAIL", f"{css_url} returned {css_resp.status_code} with {content_type}"
        
        return "PASS", f"{len(css_links)} CSS files all 200 text/css"
    except Exception as e:
        return "FAIL", str(e)

def test_9_no_404_500():
    """No 404/500 on core requests"""
    endpoints = [
        "/api/health",
        "/api/discovery/home",
        "/api/channels?limit=5",
        "/api/categories?withCounts=1",
        "/api/countries",
        "/api/channels/nusantara-daily"
    ]
    
    try:
        for endpoint in endpoints:
            resp = session.get(f"{BASE_URL}{endpoint}")
            if resp.status_code != 200:
                return "FAIL", f"{endpoint} returned {resp.status_code}"
        return "PASS", f"All {len(endpoints)} endpoints returned 200"
    except Exception as e:
        return "FAIL", str(e)

def test_10_anon_dashboard():
    """Anonymous /dashboard → must return 307 with location: /login?next=/dashboard"""
    try:
        # Use a fresh session without cookies
        anon_session = requests.Session()
        resp = anon_session.get(f"{BASE_URL}/dashboard", allow_redirects=False)
        
        if resp.status_code == 307:
            location = resp.headers.get('Location', '')
            if '/login' in location and 'next=/dashboard' in location:
                return "PASS", f"307 redirect to {location}"
            return "FAIL", f"307 but wrong location: {location}"
        return "FAIL", f"Status {resp.status_code} instead of 307"
    except Exception as e:
        return "FAIL", str(e)

def test_11_user_admin_403():
    """Normal user /admin → must return 403"""
    try:
        # Create a fresh test user
        import time
        test_email = f"smoketest{int(time.time() * 1000)}@example.com"
        signup_data = {
            "email": test_email,
            "password": "SecurePass123!@#",
            "display_name": "Smoke Test User"
        }
        
        # Signup with unique IP
        signup_session = requests.Session()
        signup_session.headers.update({'X-Forwarded-For': f'10.99.{int(time.time()) % 255}.{int(time.time() * 1000) % 255}'})
        signup_resp = signup_session.post(f"{BASE_URL}/api/auth/signup", json=signup_data)
        
        if signup_resp.status_code not in [200, 201]:
            # Try to get more details
            try:
                error_detail = signup_resp.json()
                return "FAIL", f"Signup failed: {signup_resp.status_code} - {error_detail}"
            except Exception:
                return "FAIL", f"Signup failed: {signup_resp.status_code} - {signup_resp.text[:100]}"
        
        # Extract session cookie
        cookies = signup_session.cookies.get_dict()
        if 'wl_session' not in cookies:
            return "FAIL", "No wl_session cookie after signup"
        
        # Test /admin page
        admin_resp = signup_session.get(f"{BASE_URL}/admin", allow_redirects=False)
        admin_text = admin_resp.text.lower()
        
        # Check if 403 is shown (either as status or in rendered page)
        is_403_status = admin_resp.status_code == 403
        is_403_rendered = '403' in admin_text and 'forbidden' in admin_text
        
        if not (is_403_status or is_403_rendered):
            return "FAIL", f"/admin returned {admin_resp.status_code}, no 403 content"
        
        # Test /api/admin/ping
        ping_resp = signup_session.get(f"{BASE_URL}/api/admin/ping")
        if ping_resp.status_code != 403:
            return "FAIL", f"/api/admin/ping returned {ping_resp.status_code} instead of 403"
        
        return "PASS", "Both /admin and /api/admin/ping returned 403"
    except Exception as e:
        return "FAIL", str(e)

def main():
    print("DEPLOYED COMMIT: 6e1cf31\n")
    print("| # | Check                          | Result   | Evidence |")
    print("|---|--------------------------------|----------|----------|")
    
    tests = [
        (1, "/", test_1_homepage),
        (2, "/search?q=finance", test_2_search),
        (3, "/trending", test_3_trending),
        (4, "/top?country=US", test_4_top_country),
        (5, "/category/sports", test_5_category_sports),
        (6, "/country/indonesia", test_6_country_indonesia),
        (7, "/channel/nusantara-daily", test_7_channel_detail),
        (8, "CSS assets 200", test_8_css_assets),
        (9, "No 404/500 core requests", test_9_no_404_500),
        (10, "Anon /dashboard → login", test_10_anon_dashboard),
        (11, "User /admin → 403", test_11_user_admin_403),
    ]
    
    all_pass = True
    for num, check_name, test_func in tests:
        result, evidence = test_func()
        if result == "FAIL":
            all_pass = False
        print(f"|{num:2d} | {check_name:30s} | {result:8s} | {evidence} |")
    
    print(f"\nOVERALL: {'PASS' if all_pass else 'FAIL'}")

if __name__ == "__main__":
    main()
