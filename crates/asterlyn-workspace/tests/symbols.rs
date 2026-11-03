use asterlyn_workspace::{Workspace, symbols::*};
use std::{fs, sync::atomic::AtomicBool};
fn rules() -> SymbolRuleSet {
    serde_json::from_str(include_str!("fixtures/symbol-rules.v1.json")).unwrap()
}
#[test]
fn five_languages_skip_literals_and_comments_keep_utf16_locations() {
    let r = rules();
    r.validate().unwrap();
    for (index, text, yes, no) in [
        (
            0,
            "// class Fake {}\nconst str = `function Fake2(){}`;\nconst regex = /class Nope/;\nclass Café { method() {} }\nfunction hello() {}",
            vec!["str", "regex", "Café", "method", "hello"],
            vec!["Fake", "Fake2", "Nope"],
        ),
        (
            1,
            "/* /* struct Fake; */ fn Nope(){} */\nconst TEXT: &str = r###\"fn Fake2(){}\"###;\nfn lifetime<'a>(v:&'a str) {}\nstruct Café;",
            vec!["TEXT", "lifetime", "Café"],
            vec!["Fake", "Nope", "Fake2"],
        ),
        (
            2,
            "class Café { String s=\"class Fake{}\"; void run() throws Error {} void other(); }",
            vec!["Café", "run", "other"],
            vec!["Fake"],
        ),
        (
            3,
            "object Café { val text = \"class Fake\"; fun <T> T.convert(): T = this; fun `hello world`() {} }",
            vec!["Café", "text", "convert", "hello world"],
            vec!["Fake"],
        ),
    ] {
        let (facts, partial) = extract_symbols("fn r#raw(){}", &r.profiles[1]);
        assert!(partial);
        assert!(facts.is_empty());
        assert!(
            extract_symbols("val x = object : Parent() {}", &r.profiles[3])
                .0
                .iter()
                .all(|f| f.name != "Parent")
        );
        let (facts, _) = extract_symbols(text, &r.profiles[index]);
        let names: Vec<_> = facts.iter().map(|f| f.name.as_str()).collect();
        for name in yes {
            assert!(names.contains(&name), "{index} {name}: {names:?}");
        }
        for name in no {
            assert!(!names.contains(&name));
        }
        for fact in facts {
            assert!(fact_matches(text, &fact));
        }
    }
    let (facts, _) = extract_symbols("/*😀*/ const Café=1;\r\nfunction 中文(){}", &r.profiles[0]);
    assert_eq!(facts[0].range.start.character, 13);
    assert_eq!(facts[1].range.start.line, 1);
}
#[test]
fn saved_cache_reopens_invalidates_and_never_persists_overlays() {
    let temp = tempfile::tempdir().unwrap();
    fs::write(temp.path().join("a.ts"), "class Saved {}\n").unwrap();
    let ws = Workspace::open(temp.path()).unwrap();
    let r = rules();
    let scope = vec![SymbolScope {
        profile: r.profiles[0].id.clone(),
        roots: None,
    }];
    let paths = vec!["a.ts".to_owned()];
    let stop = AtomicBool::new(false);
    let path = temp.path().join("cache/facts.json");
    let key = SymbolCache::identity(&ws, b"rules", "package-1").unwrap();
    let mut cache = SymbolCache::empty(key.clone());
    let first = cache
        .query(SymbolQuery {
            workspace: &ws,
            paths: &paths,
            rules: &r,
            scopes: &scope,
            overlays: &[],
            query: "Saved",
            cancel: &stop,
        })
        .unwrap();
    assert_eq!(first.matches.len(), 1);
    cache.save(&path).unwrap();
    let mut loaded = SymbolCache::load(&path, key.clone());
    let hot = loaded
        .query(SymbolQuery {
            workspace: &ws,
            paths: &paths,
            rules: &r,
            scopes: &scope,
            overlays: &[],
            query: "Saved",
            cancel: &stop,
        })
        .unwrap();
    if cfg!(unix) {
        assert_eq!(hot.reused_files, 1);
    }
    let overlay = SymbolOverlay {
        workspace_path: "a.ts".into(),
        text: Some("class Unsaved {}".into()),
    };
    assert_eq!(
        loaded
            .query(SymbolQuery {
                workspace: &ws,
                paths: &paths,
                rules: &r,
                scopes: &scope,
                overlays: &[overlay],
                query: "Unsaved",
                cancel: &stop
            })
            .unwrap()
            .matches
            .len(),
        1
    );
    loaded.save(&path).unwrap();
    assert!(!fs::read_to_string(&path).unwrap().contains("Unsaved"));
    assert!(
        loaded
            .query(SymbolQuery {
                workspace: &ws,
                paths: &paths,
                rules: &r,
                scopes: &scope,
                overlays: &[SymbolOverlay {
                    workspace_path: "a.ts".into(),
                    text: None
                }],
                query: "Saved",
                cancel: &stop
            })
            .unwrap()
            .matches
            .is_empty()
    );
    fs::write(temp.path().join("a.ts"), "class After {}\n").unwrap();
    assert!(
        loaded
            .query(SymbolQuery {
                workspace: &ws,
                paths: &paths,
                rules: &r,
                scopes: &scope,
                overlays: &[],
                query: "Saved",
                cancel: &stop
            })
            .unwrap()
            .matches
            .is_empty()
    );
    assert_eq!(
        loaded
            .query(SymbolQuery {
                workspace: &ws,
                paths: &paths,
                rules: &r,
                scopes: &scope,
                overlays: &[],
                query: "After",
                cancel: &stop
            })
            .unwrap()
            .matches
            .len(),
        1
    );
    fs::write(&path, b"corrupt").unwrap();
    assert_eq!(
        SymbolCache::load(&path, key.clone())
            .query(SymbolQuery {
                workspace: &ws,
                paths: &paths,
                rules: &r,
                scopes: &scope,
                overlays: &[],
                query: "After",
                cancel: &stop
            })
            .unwrap()
            .matches
            .len(),
        1
    );
    let changed = SymbolCache::identity(&ws, b"new-rules", "package-1").unwrap();
    assert_ne!(changed, key);
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    assert!(
        loaded
            .query(SymbolQuery {
                workspace: &ws,
                paths: &paths,
                rules: &r,
                scopes: &scope,
                overlays: &[],
                query: "",
                cancel: &stop
            })
            .is_err()
    );
}
#[test]
fn model_scope_excludes_unrelated_modules_and_missing_scope_never_expands() {
    let dir = tempfile::tempdir().unwrap();
    for part in ["app", "common", "other"] {
        fs::create_dir_all(dir.path().join(part)).unwrap();
        fs::write(
            dir.path().join(part).join("A.kt"),
            format!("class {}Type", part),
        )
        .unwrap();
    }
    let ws = Workspace::open(dir.path()).unwrap();
    let r = rules();
    let paths = vec!["app/A.kt".into(), "common/A.kt".into(), "other/A.kt".into()];
    let mut cache = SymbolCache::empty("test".into());
    let stop = AtomicBool::new(false);
    assert!(
        cache
            .query(SymbolQuery {
                workspace: &ws,
                paths: &paths,
                rules: &r,
                scopes: &[],
                overlays: &[],
                query: "Type",
                cancel: &stop
            })
            .unwrap()
            .matches
            .is_empty()
    );
    let scope = vec![SymbolScope {
        profile: r.profiles[3].id.clone(),
        roots: Some(vec!["app".into(), "common".into()]),
    }];
    let result = cache
        .query(SymbolQuery {
            workspace: &ws,
            paths: &paths,
            rules: &r,
            scopes: &scope,
            overlays: &[],
            query: "Type",
            cancel: &stop,
        })
        .unwrap();
    assert_eq!(result.matches.len(), 2);
    assert!(
        !result
            .matches
            .iter()
            .any(|f| f.workspace_path.starts_with("other"))
    );
}
#[test]
fn limits_malformed_rules_and_duplicate_overlays_are_bounded() {
    let mut r = rules();
    r.profiles[0].comments[0][0] = "".into();
    assert!(r.validate().is_err());
    let r = rules();
    let directory = tempfile::tempdir().unwrap();
    let workspace = Workspace::open(directory.path()).unwrap();
    let mut cache = SymbolCache::empty("test".into());
    let overlay = SymbolOverlay {
        workspace_path: "a.ts".into(),
        text: None,
    };
    assert!(
        cache
            .query(SymbolQuery {
                workspace: &workspace,
                paths: &[],
                rules: &r,
                scopes: &[],
                overlays: &[overlay.clone(), overlay],
                query: "",
                cancel: &AtomicBool::new(false)
            })
            .is_err()
    );
    let text = "class A {}\n".repeat(600);
    let (facts, partial) = extract_symbols(&text, &r.profiles[0]);
    assert_eq!(facts.len(), 512);
    assert!(partial);
    assert!(
        extract_symbols(&"x".repeat(MAX_SOURCE_BYTES + 1), &r.profiles[0])
            .0
            .is_empty()
    );
}
#[cfg(unix)]
#[test]
fn symlink_outside_workspace_cannot_be_read() {
    use std::os::unix::fs::symlink;
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    fs::write(b.path().join("secret.ts"), "class Secret{}").unwrap();
    symlink(b.path().join("secret.ts"), a.path().join("a.ts")).unwrap();
    assert!(
        Workspace::open(a.path())
            .unwrap()
            .read_symbol_source("a.ts")
            .is_err()
    );
}
