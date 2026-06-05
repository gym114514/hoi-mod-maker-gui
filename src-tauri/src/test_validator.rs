// Temporary test runner for validator
mod validator;

fn main() {
    let content = std::fs::read_to_string("C:\\Users\\31077\\AppData\\Local\\Temp\\hoi4_test_ai_will_do.txt").unwrap();
    let result = validator::validate_file(&content, "test.txt").unwrap();
    
    println!("VALID: {}", result.valid);
    println!("ERRORS ({}):", result.errors.len());
    for e in &result.errors {
        println!("  [{}] L{}: {}", e.code, e.line, e.message);
    }
    println!("WARNINGS ({}):", result.warnings.len());
    for w in &result.warnings {
        println!("  [{}] L{}: {}", w.code, w.line, w.message);
    }
}