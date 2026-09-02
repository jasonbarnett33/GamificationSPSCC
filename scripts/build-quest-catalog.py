"""Generate js/quest-catalog.js from the Gamification Spreadsheet Quests sheet."""

import json
import random
import re
from pathlib import Path

import openpyxl

SOURCE = Path(r"c:\Users\jason\Documents\Gamification Spreadsheet.xlsx")
OUT = Path(r"F:\Documents\SPSCC Gamification Cursor Project\js\quest-catalog.js")

TERM_WEEK1_START = "2026-09-21"
TERM_WEEK_COUNT = 11
CATALOG_VERSION = "spreadsheet-2026-09-02"


def slug(name, prefix):
    s = re.sub(r"[^a-z0-9]+", "-", name.lower().strip())
    s = s.strip("-")[:70]
    return f"{prefix}-{s}"


def num(value):
    if value is None or value == "":
        return 0
    return int(float(value))


def js_literal(value):
    return json.dumps(value, ensure_ascii=False)


def quest_fields(row, extra):
    days = max(1, int(row["days"] or 1))
    prompt = row["textPrompt"]
    data = {
        "id": extra["id"],
        "name": row["name"],
        "description": row["description"],
        "xpTeamwork": row["xpTeamwork"],
        "xpStudying": row["xpStudying"],
        "xpCollegeSuccess": row["xpCollegeSuccess"],
        "active": True,
        "oneTime": extra["oneTime"],
        "weekly": extra["weekly"],
        "weekLabel": extra["weekLabel"],
        "scheduleKind": extra["scheduleKind"],
        "assignedWeeks": extra["assignedWeeks"],
        "requiresText": bool(prompt),
        "textPrompt": prompt,
        "requiresValidation": row["validated"],
        "requiredCount": days,
        "requireUniqueDays": days > 1,
    }
    return data


def main():
    wb = openpyxl.load_workbook(SOURCE, data_only=True)
    ws = wb["Quests"]
    rows = []
    for row in ws.iter_rows(min_row=4, max_row=50, values_only=True):
        name = row[1]
        if not name or str(name).strip().lower() == "totals":
            continue
        week = "" if row[3] is None else str(row[3]).strip()
        rows.append(
            {
                "name": str(name).strip(),
                "description": str(row[2] or "").strip(),
                "week": week,
                "xpTeamwork": num(row[4]),
                "xpStudying": num(row[5]),
                "xpCollegeSuccess": num(row[6]),
                "isWeeklyCol": str(row[7] or "").strip().lower() == "x",
                "isRaid": str(row[8] or "").strip().lower() == "x",
                "textPrompt": str(row[9] or "").strip(),
                "days": int(row[10]) if row[10] else 1,
                "validated": str(row[11] or "").strip().lower() == "x",
            }
        )

    used_ids = set()

    def unique_id(name, prefix):
        base = slug(name, prefix)
        sid = base
        n = 2
        while sid in used_ids:
            sid = f"{base}-{n}"
            n += 1
        used_ids.add(sid)
        return sid

    week1, every, rand_weekly, randoms, raids = [], [], [], [], []
    for r in rows:
        week_l = r["week"].lower()
        if r["isRaid"] or week_l == "raids":
            raids.append(r)
        elif r["week"] == "1":
            week1.append(r)
        elif week_l == "every week":
            every.append(r)
        elif week_l == "randomly weekly":
            rand_weekly.append(r)
        elif week_l == "random":
            randoms.append(r)
        else:
            raise SystemExit(f"Unclassified quest: {r['name']!r} week={r['week']!r}")

    rw_weeks = [[] for _ in rand_weekly]
    idx = 0
    n_rw = len(rand_weekly)
    for week in range(1, TERM_WEEK_COUNT + 1):
        a = idx % n_rw
        b = (idx + 1) % n_rw
        rw_weeks[a].append(week)
        rw_weeks[b].append(week)
        idx += 2

    def week_label(weeks):
        if not weeks:
            return "Every week"
        if len(weeks) == 1:
            return f"Week {weeks[0]}"
        return "Weeks " + ", ".join(str(w) for w in weeks)

    specific_weeks = {id(q): [] for q in randoms}

    random.seed(20260921)
    first_pass = randoms[:]
    random.shuffle(first_pass)
    week = 2
    count = 0
    for q in first_pass:
        specific_weeks[id(q)].append(week)
        count += 1
        if count == 4:
            count = 0
            week += 1

    random.seed(20260922)
    second_pass = randoms[:]
    random.shuffle(second_pass)
    slot = 0
    for later_week in range(8, TERM_WEEK_COUNT + 1):
        for _ in range(4):
            if slot >= len(second_pass):
                break
            specific_weeks[id(second_pass[slot])].append(later_week)
            slot += 1

    quests = []
    for r in week1:
        quests.append(
            quest_fields(
                r,
                {
                    "id": unique_id(r["name"], "quest"),
                    "oneTime": True,
                    "weekly": False,
                    "weekLabel": "Week 1",
                    "scheduleKind": "week-specific",
                    "assignedWeeks": [1],
                },
            )
        )
    for r in every:
        quests.append(
            quest_fields(
                r,
                {
                    "id": unique_id(r["name"], "quest"),
                    "oneTime": False,
                    "weekly": True,
                    "weekLabel": "Every week",
                    "scheduleKind": "every-week",
                    "assignedWeeks": [],
                },
            )
        )
    for i, r in enumerate(rand_weekly):
        quests.append(
            quest_fields(
                r,
                {
                    "id": unique_id(r["name"], "quest"),
                    "oneTime": False,
                    "weekly": True,
                    "weekLabel": "Weekly rotation",
                    "scheduleKind": "randomly-weekly",
                    "assignedWeeks": rw_weeks[i],
                },
            )
        )
    for r in randoms:
        weeks = sorted(specific_weeks[id(r)])
        quests.append(
            quest_fields(
                r,
                {
                    "id": unique_id(r["name"], "quest"),
                    "oneTime": True,
                    "weekly": False,
                    "weekLabel": week_label(weeks),
                    "scheduleKind": "week-specific",
                    "assignedWeeks": weeks,
                },
            )
        )

    raid_docs = []
    for r in raids:
        name_l = r["name"].lower()
        required = 10
        if "50%" in name_l or "half" in name_l or "level 3" in name_l:
            required = 1
        raid_docs.append(
            {
                "id": unique_id(r["name"], "raid"),
                "name": r["name"],
                "description": r["description"],
                "xpTeamwork": r["xpTeamwork"],
                "xpStudying": r["xpStudying"],
                "xpCollegeSuccess": r["xpCollegeSuccess"],
                "active": True,
                "requiredParticipants": required,
                "requiresValidation": True,
                "weekLabel": "",
            }
        )

    def emit_obj(obj, indent=2):
        pad = " " * indent
        lines = ["{"]
        items = list(obj.items())
        for i, (k, v) in enumerate(items):
            comma = "," if i < len(items) - 1 else ""
            lines.append(f"{pad}  {k}: {js_literal(v)}{comma}")
        lines.append(pad[:-2] + "}" if indent == 2 else (" " * (indent - 2) + "}"))
        # fix closing indent - just use simple
        return None

    parts = []
    parts.append("/* global TERM_WEEK1_START, TERM_WEEK_COUNT, QUEST_CATALOG_VERSION, QUEST_CATALOG, RAID_CATALOG */")
    parts.append(f"const TERM_WEEK1_START = {js_literal(TERM_WEEK1_START)};")
    parts.append(f"const TERM_WEEK_COUNT = {TERM_WEEK_COUNT};")
    parts.append(f"const QUEST_CATALOG_VERSION = {js_literal(CATALOG_VERSION)};")
    parts.append("")
    parts.append("const QUEST_CATALOG = [")
    for i, q in enumerate(quests):
        comma = "," if i < len(quests) - 1 else ""
        assigned = q["assignedWeeks"]
        parts.append("  {")
        parts.append(f"    id: {js_literal(q['id'])},")
        parts.append(f"    name: {js_literal(q['name'])},")
        parts.append(f"    description: {js_literal(q['description'])},")
        parts.append(f"    xpTeamwork: {q['xpTeamwork']},")
        parts.append(f"    xpStudying: {q['xpStudying']},")
        parts.append(f"    xpCollegeSuccess: {q['xpCollegeSuccess']},")
        parts.append("    active: true,")
        parts.append(f"    oneTime: {str(q['oneTime']).lower()},")
        parts.append(f"    weekly: {str(q['weekly']).lower()},")
        parts.append(f"    weekLabel: {js_literal(q['weekLabel'])},")
        parts.append(f"    scheduleKind: {js_literal(q['scheduleKind'])},")
        parts.append(f"    assignedWeeks: {js_literal(assigned)},")
        parts.append(f"    requiresText: {str(q['requiresText']).lower()},")
        parts.append(f"    textPrompt: {js_literal(q['textPrompt'])},")
        parts.append(f"    requiresValidation: {str(q['requiresValidation']).lower()},")
        parts.append(f"    requiredCount: {q['requiredCount']},")
        parts.append(f"    requireUniqueDays: {str(q['requireUniqueDays']).lower()},")
        parts.append("  }" + comma)
    parts.append("];")
    parts.append("")
    parts.append("const RAID_CATALOG = [")
    for i, r in enumerate(raid_docs):
        comma = "," if i < len(raid_docs) - 1 else ""
        parts.append("  {")
        parts.append(f"    id: {js_literal(r['id'])},")
        parts.append(f"    name: {js_literal(r['name'])},")
        parts.append(f"    description: {js_literal(r['description'])},")
        parts.append(f"    xpTeamwork: {r['xpTeamwork']},")
        parts.append(f"    xpStudying: {r['xpStudying']},")
        parts.append(f"    xpCollegeSuccess: {r['xpCollegeSuccess']},")
        parts.append("    active: true,")
        parts.append(f"    requiredParticipants: {r['requiredParticipants']},")
        parts.append("    requiresValidation: true,")
        parts.append("    weekLabel: '',")
        parts.append("  }" + comma)
    parts.append("];")
    parts.append("")

    OUT.write_text("\n".join(parts) + "\n", encoding="utf-8")

    print(f"Wrote {OUT}")
    print(f"quests={len(quests)} raids={len(raid_docs)}")
    print("Week 1:", [q["name"] for q in quests if q["assignedWeeks"] == [1] and q["scheduleKind"] == "week-specific"])
    print("Every week:", [q["name"] for q in quests if q["scheduleKind"] == "every-week"])
    print("Randomly weekly assignments:")
    for q in quests:
        if q["scheduleKind"] == "randomly-weekly":
            print(f"  {q['name']}: weeks {q['assignedWeeks']}")
    print("Specific weeks:")
    by_week = {}
    for q in quests:
        if q["scheduleKind"] == "week-specific":
            for w in q["assignedWeeks"]:
                by_week.setdefault(w, []).append(q["name"])
    for w in sorted(by_week):
        print(f"  Week {w} ({len(by_week[w])}):")
        for name in by_week[w]:
            print(f"    - {name}")
    print("Raids:")
    for r in raid_docs:
        print(f"  {r['name']} need={r['requiredParticipants']}")


if __name__ == "__main__":
    main()
