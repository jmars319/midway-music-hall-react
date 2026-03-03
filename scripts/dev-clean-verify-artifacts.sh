#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

php -r '
if (!isset($_SERVER["REQUEST_METHOD"])) {
    $_SERVER["REQUEST_METHOD"] = "CLI";
}
require $argv[1];
$pdo = \Midway\Backend\Database::connection();
$match = "COALESCE(artist_name,\"\") REGEXP \"(^|[[:space:]])(Verify|Test)\" "
    . "OR COALESCE(title,\"\") REGEXP \"(^|[[:space:]])(Verify|Test)\" "
    . "OR COALESCE(artist_name,\"\") LIKE \"%Verify%\" "
    . "OR COALESCE(title,\"\") LIKE \"%Verify%\"";
$ids = $pdo->query("SELECT id FROM events WHERE $match ORDER BY id")->fetchAll(PDO::FETCH_COLUMN);
if (!$ids) {
    echo "cleanup: no verify/test artifacts found\n";
    exit(0);
}
$placeholders = implode(",", array_fill(0, count($ids), "?"));
$pdo->beginTransaction();
$counts = [];
foreach (["event_seating_snapshots", "seat_requests", "seating", "event_series_meta"] as $table) {
    $stmt = $pdo->prepare("DELETE FROM $table WHERE event_id IN ($placeholders)");
    $stmt->execute($ids);
    $counts[$table] = $stmt->rowCount();
}
$eventStmt = $pdo->prepare("DELETE FROM events WHERE id IN ($placeholders)");
$eventStmt->execute($ids);
$counts["events"] = $eventStmt->rowCount();
$pdo->commit();
echo "cleanup: removed {$counts["events"]} events\n";
echo json_encode($counts, JSON_PRETTY_PRINT), "\n";
' "$ROOT_DIR/backend/bootstrap.php"
