// grammar and corpus adopted from: https://github.com/aws/event-ruler
module.exports = grammar(require("tree-sitter-json/grammar"), {
  name: "eventrule",

  conflicts: ($) => [[$._rule_value_array, $._value]],

  rules: {
    pair: ($, previous) =>
      choice(
        previous,
        $.rule_value_matching,
        $.rule_prefix_matching,
        $.rule_suffix_matching,
        $.rule_exactly_matching,
        $.rule_equals_ignore_case_matching,
        $.rule_wildcard_matching,
        $.rule_anything_but_matching,
        $.rule_numeric_matching,
        $.rule_ip_address_matching,
        $.rule_exists_matching,
        $.rule_or_matching
      ),

    rule_constant_exactly: ($) => '"exactly"',
    rule_constant_prefix: ($) => '"prefix"',
    rule_constant_suffix: ($) => '"suffix"',
    rule_constant_equals_ignore_case: ($) => '"equals-ignore-case"',
    rule_constant_wildcard: ($) => '"wildcard"',
    rule_constant_anything_but: ($) => '"anything-but"',
    rule_constant_numeric: ($) => '"numeric"',
    rule_constant_cidr: ($) => '"cidr"',
    rule_constant_exists: ($) => '"exists"',
    rule_constant_or: ($) => '"$or"',

    _rule_value_array: ($) => squareBracketScoped(choice(commaSep1($.number), commaSep1($.string))),
    rule_value_matching: ($) => seq(alias($.string, $.rule_constant_value), ":", alias($._rule_value_array, $.array)),
    rule_exactly_matching: ($) => seq($.rule_constant_exactly, ":", $.string),
    rule_prefix_matching: ($) => seq($.rule_constant_prefix, ":", $.string),
    rule_suffix_matching: ($) => seq($.rule_constant_suffix, ":", $.string),
    rule_equals_ignore_case_matching: ($) => seq($.rule_constant_equals_ignore_case, ":", $.string),
    rule_wildcard_matching: ($) => seq($.rule_constant_wildcard, ":", $.string),
    rule_anything_but_matching: ($) =>
      seq(
        $.rule_constant_anything_but,
        ":",
        choice(
          $.number,
          $.string,
          alias($._rule_value_array, $.array),
          curlyBracketScoped(alias($.rule_prefix_matching, $.rule_nested_prefix_matching))
        )
      ),
    rule_numeric_comparison_sign: ($) => choice('"<"', '">"', '"<="', '">="'),
    rule_numeric_equality_sign: ($) => '"="',
    rule_numeric_matching: ($) =>
      seq(
        $.rule_constant_numeric,
        ":",
        choice(
          $.number,
          squareBracketScoped(
            choice(
              seq($.rule_numeric_equality_sign, ",", $.number),
              commaSep1(seq($.rule_numeric_comparison_sign, ",", $.number))
            )
          )
        )
      ),
    rule_ip_address_matching: ($) => seq($.rule_constant_cidr, ":", $.string),
    rule_exists_matching: ($) => seq($.rule_constant_exists, ":", $.boolean),
    rule_or_matching: ($) =>
      seq(
        $.rule_constant_or,
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
