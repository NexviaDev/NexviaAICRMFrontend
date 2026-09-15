package com.nexvia.crm;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 웹(Capacitor)에서 내려준 오늘 일정을 위젯이 읽을 수 있게 저장합니다.
 */
public final class CalendarWidgetStore {
    public static final String PREFS = "nexvia_calendar_widget";
    public static final String KEY_PAYLOAD = "payload_json";
    public static final String KEY_PENDING_PATH = "pending_launch_path";
    public static final int MAX_EVENTS = 5;

    private CalendarWidgetStore() {}

    public static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static void savePayload(Context context, String json) {
        prefs(context).edit().putString(KEY_PAYLOAD, json == null ? "" : json).apply();
    }

    public static String readPayload(Context context) {
        return prefs(context).getString(KEY_PAYLOAD, "");
    }

    public static void setPendingLaunchPath(Context context, String path) {
        prefs(context).edit().putString(KEY_PENDING_PATH, path == null ? "" : path).apply();
    }

    public static String peekPendingLaunchPath(Context context) {
        String path = prefs(context).getString(KEY_PENDING_PATH, "");
        return path == null ? "" : path;
    }

    public static void clearPendingLaunchPath(Context context) {
        prefs(context).edit().remove(KEY_PENDING_PATH).apply();
    }

    public static String takePendingLaunchPath(Context context) {
        SharedPreferences p = prefs(context);
        String path = p.getString(KEY_PENDING_PATH, "");
        if (path != null && !path.isEmpty()) {
            p.edit().remove(KEY_PENDING_PATH).apply();
        }
        return path == null ? "" : path;
    }

    public static JSONObject emptyPayload() {
        JSONObject o = new JSONObject();
        try {
            o.put("header", "");
            o.put("subtitle", "");
            o.put("events", new JSONArray());
            o.put("updatedAt", 0);
        } catch (Exception ignored) {
        }
        return o;
    }

    public static JSONObject parsePayload(Context context) {
        String raw = readPayload(context);
        if (raw == null || raw.trim().isEmpty()) {
            return emptyPayload();
        }
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return emptyPayload();
        }
    }
}
