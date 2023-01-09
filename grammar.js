// grammar and corpus adopted from: https://github.com/aws/event-ruler
module.exports = grammar(require("tree-sitter-json/grammar"), {
  name: "eventrule",

  conflicts: ($) => [[$.array_string, $.array_number]],

  rules: {
    object: ($) =>
      seq(
        "{",
        commaSep(
          choice(
            $.pair,
            $.rule_prefix_matching,
            $.rule_suffix_matching,
            $.rule_equals_ignore_case_matching,
            $.rule_wildcard_matching,
            $.rule_anything_but_matching,
            $.rule_numeric_matching,
            $.rule_ip_address_matching,
            $.rule_exists_matching,
            $.rule_or_matching
          )
        ),
        "}"
      ),

    array_number: ($) => seq("[", commaSep($.number), "]"),
    array_string: ($) => seq("[", commaSep($.string), "]"),

    rule_prefix_matching: ($) => seq('"prefix"', ":", $.string),
    rule_suffix_matching: ($) => seq('"suffix"', ":", $.string),
    rule_equals_ignore_case_matching: ($) => seq('"equals-ignore-case"', ":", $.string),
    rule_wildcard_matching: ($) => seq('"wildcard"', ":", $.string),
    rule_anything_but_matching: ($) =>
      seq('"anything-but"', ":", choice($.number, $.string, $.array_number, $.array_string, $.rule_prefix_matching)),
    rule_numeric_comparison_sign: ($) => choice('"<"', '">"', '"<="', '">="'),
    rule_numeric_matching: ($) =>
      seq(
        '"numeric"',
        ":",
        choice(
          $.number,
          seq(
            "[",
            choice(seq('"="', ",", $.number), commaSep1(seq($.rule_numeric_comparison_sign, ",", $.number))),
            "]"
          )
        )
      ),
    rule_ip_address_matching: ($) => seq('"cidr"', ":", $.string),
    rule_exists_matching: ($) => seq('"exists"', ":", $.boolean),
    rule_or_matching: ($) => seq('"$or"', seq(":", "[", commaSep($.object), "]")),

    boolean: ($) => choice($.true, $.false),
  },
});

function commaSep1(rule) {
  return seq(rule, repeat(seq(",", rule)));
}

function commaSep(rule) {
  return optional(commaSep1(rule));
}
