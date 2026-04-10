package com.ucs.business.util;

/**
 * Utility for computing DDS partition names.
 * 
 * Partition naming rules:
 * - observer role: fixed "observer"
 * - commander role: fixed "commander"
 * - others: "{username_initials}_{db_id}" (e.g., zhangsan id=2 -> "zs_2")
 */
public class PartitionNameUtil {

    private PartitionNameUtil() {
    }

    /**
     * Compute partition name for a user.
     *
     * @param roleName The user's role name (observer, commander, operator, leader)
     * @param username The username (e.g., "zhangsan", "lisi")
     * @param userId   The database-generated user ID
     * @return Partition name (e.g., "observer", "commander", "zs_2")
     */
    public static String computePartitionName(String roleName, String username, Long userId) {
        if ("observer".equalsIgnoreCase(roleName)) {
            return "observer";
        }
        if ("commander".equalsIgnoreCase(roleName)) {
            return "commander";
        }
        String initials = extractInitials(username);
        return initials + "_" + userId;
    }

    /**
     * Extract initials from a pinyin-style username.
     * Splits by common Chinese surname patterns to get surname initial + given name initial.
     * 
     * Examples:
     *   "zhangsan"  -> "zs"
     *   "lisi"      -> "ls"
     *   "wangwu"    -> "ww"
     *   "zhaoliu"   -> "zl"
     *   "qianqi"    -> "qq"
     *   "sunba"     -> "sb"
     */
    public static String extractInitials(String username) {
        if (username == null || username.isEmpty()) {
            return "u";
        }
        username = username.toLowerCase().trim();

        // Common Chinese pinyin surnames (sorted by length desc to match longest first)
        String[] surnames = {
            "zhuang", "shuang",
            "zhang", "zheng", "zhou", "zhong",
            "chang", "cheng", "chen",
            "shang", "sheng", "shen",
            "huang",
            "wang", "yang", "tang", "liang", "jiang", "xiang",
            "zhao", "qian", "zhuo", "chao", "shao",
            "feng", "deng", "meng", "peng", "zeng",
            "gong", "kong", "long", "song", "dong", "tong",
            "ying", "ding", "jing", "ling", "ming", "ning", "ping", "ting", "xing",
            "guo", "huo", "luo", "zuo",
            "bai", "cai", "dai", "gai", "hai", "lai", "mai", "tai",
            "cao", "gao", "hao", "mao", "tao", "yao",
            "ban", "can", "dan", "fan", "gan", "han", "lan", "pan", "ran", "tan", "wan", "yan",
            "bin", "chi", "chu",
            "dou", "duan",
            "fang", "fu",
            "gui", "gu",
            "he", "hu", "hua",
            "ji", "jia",
            "ke", "ku",
            "lei", "li", "lin", "liu", "lu",
            "ma", "mo", "mu",
            "ou",
            "qi", "qu", "qiu",
            "ren", "rui",
            "si", "su", "sun",
            "wei", "wu",
            "xi", "xia", "xie", "xin", "xu", "xue",
            "yu", "yue",
            "zhu", "zi", "zou",
            "ba", "bi", "bo", "bu",
            "da", "di", "du",
            "fa",
            "ge",
            "na", "ni",
            "pi", "pu",
            "ru",
            "sa", "sha", "she", "shi", "shu",
            "ta", "ti", "tu",
            "wa",
            "ya", "ye", "yi",
            "za", "ze", "zha", "zhe", "zhi", "zu"
        };

        for (String surname : surnames) {
            if (username.startsWith(surname) && username.length() > surname.length()) {
                char surnameInitial = surname.charAt(0);
                char givenInitial = username.charAt(surname.length());
                return "" + surnameInitial + givenInitial;
            }
        }

        // Fallback: first 2 chars or first char
        if (username.length() >= 2) {
            return username.substring(0, 2);
        }
        return username.substring(0, 1);
    }
}
