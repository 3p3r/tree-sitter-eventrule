// grammar and corpus adopted from: https://github.com/aws/event-ruler
module.exports = grammar(require("tree-sitter-json/grammar"), {
  name: "eventrule",

  conflicts: ($) => [
    [$.rule_value_matching, $.array],
    [$.rule_value_array, $.array],
    [$.rule_value_array, $._value],
  ],

  rules: {
    object: ($) =>
      seq(
        "{",
        commaSep(
          choice(
            $.pair,
            $.rule_value_matching,
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

    array: ($, previous) => choice(previous, $.rule_value_array),

    rule_value_array: ($) => choice(squareBracketScoped(commaSep($.number)), squareBracketScoped(commaSep($.string))),
    rule_value_matching: ($) => seq($.string, ":", $.rule_value_array),
    rule_prefix_matching: ($) => seq('"prefix"', ":", $.string),
    rule_suffix_matching: ($) => seq('"suffix"', ":", $.string),
    rule_equals_ignore_case_matching: ($) => seq('"equals-ignore-case"', ":", $.string),
    rule_wildcard_matching: ($) => seq('"wildcard"', ":", $.string),
    rule_anything_but_matching: ($) =>
      seq(
        '"anything-but"',
        ":",
        choice($.number, $.string, $.rule_value_array, curlyBracketScoped($.rule_prefix_matching))
      ),
    rule_numeric_comparison_sign: ($) => choice('"<"', '">"', '"<="', '">="'),
    rule_numeric_matching: ($) =>
      seq(
        '"numeric"',
        ":",
        choice(
          $.number,
          squareBracketScoped(
            choice(seq('"="', ",", $.number), commaSep1(seq($.rule_numeric_comparison_sign, ",", $.number)))
          )
        )
      ),
    rule_ip_address_matching: ($) => seq('"cidr"', ":", $.string),
    rule_exists_matching: ($) => seq('"exists"', ":", $.boolean),
    rule_or_matching: ($) =>
      seq(
        '"$or"',
        seq(":", choice(squareBracketScoped(commaSep1($.object)), curlyBracketScoped(commaSep2($.rule_value_matching))))
      ),

    boolean: ($) => choice($.true, $.false),
  },
});

function curlyBracketScoped(...rules) {
  return seq("{", ...rules, "}");
}

function squareBracketScoped(...rules) {
  return seq("[", ...rules, "]");
}

function commaSep2(rule) {
  return seq(rule, repeat1(seq(",", rule)));
}

function commaSep1(rule) {
  return seq(rule, repeat(seq(",", rule)));
}

function commaSep(rule) {
  return optional(commaSep1(rule));
}
