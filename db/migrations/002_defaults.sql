-- Platform defaults. These are DATA, editable by administrators in the admin portal.
-- Nothing in application code assumes any of these numbers.

insert into system_settings(key, value) values
 ('features.buyback',          '{"enabled": false, "legal_review_ref": null, "approved_by": null, "approved_at": null}'),
 ('features.auto_reallocation','{"enabled": false, "legal_review_ref": null}'),
 ('features.event_resale',     '{"enabled": false, "legal_review_ref": null, "cap_bps": 11000}'),
 ('payments.processing',       '{"bps": 175, "fixed_cents": 30}'),
 ('booking.hold_minutes',      '{"minutes": 10}'),
 ('buyback.limits',            '{"max_offers_per_reservation": 2, "customer_response_hours": 24}'),
 ('legal.terms_version',       '{"version": "2026-11-draft-1"}'),
 ('pricing.bounds',            '{"min_multiplier": 0.6, "max_multiplier": 1.5}');

-- Customer-paid mandatory service fee (GST-inclusive) and partner commissions.
insert into fee_rules(payer, applies_to, scope, category, kind, rate_bps, fixed_cents, min_cents, max_cents, note) values
 ('customer','booking','global',null,'percentage',400,0,200,1500,'Default customer service fee'),
 ('customer','buyback','global',null,'percentage',400,0,200,1500,'Customer fee on buyback resale bookings'),
 ('partner','booking','global',null,'percentage',1500,0,0,null,'Default partner commission'),
 ('partner','booking','category','hotel','percentage',1500,0,0,null,'Hotels: percentage per completed booking'),
 ('partner','booking','category','restaurant','percent_plus_fixed',500,200,0,null,'Restaurants: small percentage plus fixed booking fee'),
 ('partner','booking','category','event','percentage',1200,0,0,null,'Events: percentage per ticket or package'),
 ('partner','buyback','global',null,'percentage',1000,0,0,null,'Fee on buyback resale (separately configurable)'),
 ('partner','resale','global',null,'percentage',800,0,0,null,'Fee on regulated event resale');

insert into pricing_rules(scope, rule_type, params) values
 ('global','time_decay','{"tiers":[{"max_hours":3,"mult":0.78},{"max_hours":12,"mult":0.85},{"max_hours":24,"mult":0.90},{"max_hours":72,"mult":0.96},{"max_hours":100000,"mult":1.0}]}'),
 ('global','scarcity','{"tiers":[{"max_ratio":0.2,"mult":1.12},{"max_ratio":0.4,"mult":1.05},{"max_ratio":0.7,"mult":1.0},{"max_ratio":1.01,"mult":0.95}]}'),
 ('global','demand','{"per_waitlist_bps":300,"cap_bps":2000}'),
 ('global','velocity','{"window_hours":24,"per_booking_bps":150,"cap_bps":1000}'),
 ('global','day_of_week','{"mult":{"mon":0.94,"tue":0.94,"wed":0.97,"thu":1.0,"fri":1.08,"sat":1.1,"sun":0.95}}'),
 ('global','seasonal','{"months":{"1":1.1,"2":1.05,"3":1.12,"4":1.0,"5":0.95,"6":0.92,"7":0.92,"8":0.95,"9":1.04,"10":1.05,"11":1.08,"12":1.12}}');

insert into special_events(name, city, starts_on, ends_on, multiplier_bps) values
 ('Boxing Day Test (indicative dates)',      'Melbourne', '2026-12-24', '2026-12-29', 11500),
 ('New Year''s Eve',                          'Melbourne', '2026-12-30', '2027-01-01', 12500),
 ('Australian Open (indicative dates)',      'Melbourne', '2027-01-18', '2027-01-31', 12000),
 ('Grand Prix weekend (indicative dates)',   'Melbourne', '2027-03-04', '2027-03-07', 12000);
